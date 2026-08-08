{
  description = "Rugged: Among Us-style social deduction on MagicBlock Ephemeral Rollups";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    crane.url = "github:ipetkov/crane";
  };

  outputs = { self, nixpkgs, flake-utils, crane }:
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

        checks.cargo-check =
          let
            commonArgs = {
              inherit src;
              strictDeps = true;
              nativeBuildInputs = with pkgs; [ pkg-config ];
              buildInputs = with pkgs; [ openssl ];
            };
            cargoArtifacts = craneLib.buildDepsOnly commonArgs;
          in
          # Anchor programs target BPF via the Solana toolchain; a plain
          # `cargo check` against the host target still validates that the
          # Rust source, account structs, and instruction signatures compile
          # and type-check, which is what this MVP check gates on.
          craneLib.cargoBuild (commonArgs // {
            inherit cargoArtifacts;
            cargoBuildCommand = "cargo check --workspace";
          });

        checks.cargo-test =
          let
            commonArgs = {
              inherit src;
              strictDeps = true;
              nativeBuildInputs = with pkgs; [ pkg-config ];
              buildInputs = with pkgs; [ openssl ];
            };
            cargoArtifacts = craneLib.buildDepsOnly commonArgs;
          in
          # Pure game-logic unit tests (adjacency, vote tally, win
          # conditions) run against the host target; no Solana/BPF toolchain
          # needed for these.
          craneLib.cargoTest (commonArgs // {
            inherit cargoArtifacts;
          });

        checks.app-build = pkgs.buildNpmPackage {
          pname = "rugged-app";
          version = "0.1.0";
          src = ./app;
          npmDepsHash = "sha256-gGvkioe/p1y77x/TLbXH6zK+Lx29gkVMSPE39MI4R0A=";
          dontNpmBuild = false;
          installPhase = "mkdir -p $out && cp -r dist $out/";
        };
      });
}
