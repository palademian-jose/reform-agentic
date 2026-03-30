import { initializeRepairState, runRepairLoop } from "./repairLoop";
import { loadRuntimeConfig } from "./runtimeConfig";

async function main() {
  const runtimeConfig = await loadRuntimeConfig();
  await initializeRepairState(runtimeConfig ?? undefined);
  await runRepairLoop(runtimeConfig ?? undefined);
}

main().catch((error) => {
  console.error("run.failed", error);
  process.exitCode = 1;
});
