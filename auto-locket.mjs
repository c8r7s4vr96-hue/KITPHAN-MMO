import { fetchLocketPackages, getCtvProfile } from "./lib/locket-provider.js";
import { runAutoLocketActivation } from "./lib/locket-auto-worker.js";

async function main() {
  const mode = process.argv[2] || "sync";
  if (mode === "sync") {
    const packages = await fetchLocketPackages();
    const ctv = await getCtvProfile();
    console.log(JSON.stringify({ ctvBalanceCoin: ctv?.balanceCoin, packages }, null, 2));
  } else if (mode === "activate") {
    const username = process.argv[3];
    const packageCode = process.argv[4] || "LKG1Y";
    const result = await runAutoLocketActivation({
      id: `CLI-${Date.now()}`,
      username,
      packageCode,
    });
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
