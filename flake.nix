{
  description = "Rugged: Among Us-style social deduction on MagicBlock Ephemeral Rollups";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    crane.url = "github:ipetkov/crane";
    # Shared Kani formal-verification infra (see kani-nix flake.nix header
    # for the full contract). Path input for now — swap for a git remote if
    # this repo needs to build off this machine.
    kani-nix.url = "path:/home/jonas/workspace/kani-nix";
  };

  outputs = { self, nixpkgs, flake-utils, crane, kani-nix }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        craneLib = crane.mkLib pkgs;
        src = craneLib.cleanCargoSource ./.;
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            rustc
            cargo
            rustfmt
            clippy
            pkg-config
            openssl
            nodejs_22
          ];
          RUST_SRC_PATH = "${pkgs.rust.packages.stable.rustPlatform.rustLibSrc}";
          shellHook = ''
            echo "Rugged dev shell. cargo/rustc from nixpkgs."
            echo "Install Solana CLI + Anchor CLI (avm) separately per README (not packaged here)."
          '';
        };

        packages = {
          # Sec3 X-Ray: static vulnerability analyzer for Solana/Anchor programs.
          # Source: https://github.com/sec3-product/x-ray (x86_64-linux only; the
          # upstream tarball ships three ELFs needing autoPatchelfHook + libomp).
          xray = pkgs.stdenv.mkDerivation rec {
            pname = "xray";
            version = "0.0.6";
            src = pkgs.fetchurl {
              url = "https://github.com/sec3-product/x-ray/releases/download/v${version}/x-ray-v${version}-linux-amd64.tar.gz";
              hash = "sha256-EQufu02Z/IC+O7FWBPs5IWiDpeZsLkEHHmYJyLU6bR0=";
            };
            nativeBuildInputs = [ pkgs.autoPatchelfHook ];
            buildInputs = [
              pkgs.stdenv.cc.cc.lib # libgcc_s.so.1 for sol-code-parser and sol-code-analyzer
            ];
            dontConfigure = true;
            dontBuild = true;
            sourceRoot = ".";
            installPhase = ''
              mkdir -p $out/bin $out/lib $out/conf
              mv bin/libomp.so $out/lib/
              cp bin/xray bin/sol-code-parser bin/sol-code-analyzer $out/bin/
              cp conf/xray.json $out/conf/
            '';
            meta = {
              description = "Sec3 X-Ray static vulnerability analyzer for Solana programs";
              homepage = "https://github.com/sec3-product/x-ray";
              platforms = [ "x86_64-linux" ];
              mainProgram = "xray";
            };
          };
        };

        checks = {
          cargo-check = craneLib.mkCargoDerivation {
            inherit src;
            pname = "rugged-cargo-check";
            version = "0.1.0";
            cargoArtifacts = null;
            # Anchor programs target BPF via the Solana toolchain; a plain
            # `cargo check` against the host target still validates that the
            # Rust source, account structs, and instruction signatures compile
            # and type-check, which is what this MVP check gates on.
            buildPhaseCargoCommand = "cargo check --workspace --all-targets --locked";
            nativeBuildInputs = with pkgs; [ pkg-config ];
            buildInputs = with pkgs; [ openssl ];
          };

          # rugged-core is pure Rust (no anchor/solana dep): its unit tests
          # run as a fast, hermetic Nix check independent of the Anchor/BPF
          # toolchain that the rest of the workspace needs.
          cargo-test-core = craneLib.cargoTest {
            inherit src;
            pname = "rugged-core-test";
            cargoArtifacts = null;
            cargoTestExtraArgs = "-p rugged-core";
            nativeBuildInputs = with pkgs; [ pkg-config ];
            buildInputs = with pkgs; [ openssl ];
          };
        } // pkgs.lib.optionalAttrs (system == "x86_64-linux") {
          # Kani formal-verification check for rugged-core's pure arithmetic
          # and game logic. ON-DEMAND / HEAVY (cold build ~tens of minutes);
          # NOT included in the default `nix flake check`.
          # Run explicitly:
          #   LOCAL_OK=1 nix build .#checks.x86_64-linux.kani-rugged-core \
          #     --no-link --print-build-logs --max-jobs auto \
          #     --option substituters "" --option builders ""
          #
          # src carries only the workspace Cargo.lock plus a minimal
          # single-member workspace Cargo.toml, so kani compiles and
          # verifies just rugged-core (which has zero external deps).
          kani-rugged-core = kani-nix.lib.mkKaniCheck {
            inherit pkgs;
            src = pkgs.runCommand "kani-rugged-core-src" {} ''
              mkdir -p $out/rugged-core
              cp -r ${self}/programs-core/rugged-core/. $out/rugged-core/
              cat > $out/Cargo.toml <<'EOF'
              [workspace]
              members = ["rugged-core"]
              resolver = "2"
              EOF
              cp ${self}/Cargo.lock $out/Cargo.lock
            '';
            package = "rugged-core";
          };

          # Sec3 X-Ray static analysis check over the workspace. X-Ray always
          # exits 0 regardless of findings; gate on the ratchet comparison
          # against .xray-baseline.json (empty until the first triage pass,
          # so this fails on any finding today — by design, tighten by
          # triaging real findings into the baseline as they surface).
          #
          # Run explicitly (heavy; not in default `nix flake check`):
          #   LOCAL_OK=1 nix build .#checks.x86_64-linux.xray-all \
          #     --no-link --print-build-logs --max-jobs auto \
          #     --builders "" --substituters "https://cache.nixos.org"
          xray-all = pkgs.runCommand "xray-all" {
            src = pkgs.lib.cleanSourceWith {
              src = ./.;
              filter = name: type:
                let base = baseNameOf name; in
                base != "target" && base != ".anchor" && base != ".xray"
                && base != "node_modules" && base != ".worktrees"
                && base != ".cache" && base != ".claude"
                && !(pkgs.lib.hasPrefix "result" base);
            };
            baseline = ./.xray-baseline.json;
            nativeBuildInputs = [ self.packages.${system}.xray pkgs.jq pkgs.python3 ];
          } ''
            # Copy source to a writable temp dir; xray writes .xray/ to CWD.
            cp -r $src/. $TMPDIR/src
            chmod -R u+w $TMPDIR/src
            cd $TMPDIR/src

            # Run X-Ray; always exits 0 — gate by ratchet comparison below.
            xray . || true

            # Ratchet: compare current findings against triaged baseline.
            # Fails if any (type+program+account+id+filename) key is new or
            # exceeds its baseline count. Line numbers excluded (they churn).
            python3 - <<'PYEOF'
import json, glob, sys, os
from collections import Counter

all_findings = []
for f in sorted(glob.glob(".xray/build/raw_programs_*.ll.json")):
    program = f.replace(".xray/build/raw_programs_", "").replace(".ll.json", "")
    with open(f) as fh:
        data = json.load(fh)
    for acc in data.get("untrustfulAccounts", []):
        all_findings.append((
            "untrustfulAccount", program,
            acc.get("account", ""), str(acc.get("id", "")),
            acc.get("inst", {}).get("filename", "")
        ))
    for op in data.get("unsafeOperations", []):
        all_findings.append((
            "unsafeOperation", program,
            op.get("account", ""), str(op.get("id", "")),
            op.get("inst", {}).get("filename", "")
        ))

current = Counter(all_findings)
with open(os.environ["baseline"]) as fh:
    bdata = json.load(fh)
baseline_map = {(e["type"], e["program"], e["account"], e["id"], e["filename"]): e["count"] for e in bdata["findings"]}

violations = []
for key, cnt in sorted(current.items()):
    allowed = baseline_map.get(key, 0)
    if cnt > allowed:
        typ, prog, acct, fid, fname = key
        violations.append(f"  NEW [{typ}] program={prog} account={acct!r} id={fid} file={fname} (count={cnt}, baseline={allowed})")

print(f"X-Ray: {sum(current.values())} findings total ({len(current)} unique keys), {len(baseline_map)} keys in baseline")
if violations:
    print(f"\nerror: {len(violations)} untriaged finding(s) not in baseline:")
    for v in violations:
        print(v)
    print("\nTo triage: regenerate .xray-baseline.json or add entries with the correct count.")
    sys.exit(1)
else:
    print("All findings are within the triaged baseline — gate passes.")
PYEOF

            mkdir -p $out
            echo "ok" > $out/xray-passed
          '';
        };
      });
}
