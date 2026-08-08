// Rugged client entry point (MVP skeleton).
// Wires the dual-connection stubs; UI and Anchor program calls land next.

import { baseConnection, erConnection } from "./connection";

async function main() {
  const app = document.getElementById("app");
  if (!app) return;

  const [baseVersion, erVersion] = await Promise.allSettled([
    baseConnection.getVersion(),
    erConnection.getVersion(),
  ]);

  app.innerHTML = `
    <h1>Rugged</h1>
    <p>Base layer: ${baseVersion.status === "fulfilled" ? "reachable" : "unreachable"}</p>
    <p>Ephemeral rollup: ${erVersion.status === "fulfilled" ? "reachable" : "unreachable"}</p>
  `;
}

main();
