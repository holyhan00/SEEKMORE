const {
  assertReleaseToolchain,
  repoRoot,
  run,
  pnpmCommand,
} = require('./distribution-lib.cjs');

async function main() {
  const root = repoRoot(__dirname);
  await assertReleaseToolchain(root);
  await run(pnpmCommand(), ['build'], { cwd: root, env: process.env });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
