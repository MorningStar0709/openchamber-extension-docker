// Builds the committed bundles. OpenChamber installs this package from Git
// without building it, so every entry's main.js is checked in.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const targets = [
  // Sandboxed iframes cannot load ES modules: one classic IIFE each.
  { entry: 'src/panel/main.ts', out: 'panel/main.js', node: false },
  { entry: 'src/status/main.ts', out: 'status/main.js', node: false },
  { entry: 'src/background/main.ts', out: 'background/main.js', node: false },
  // The service runs under Node; built-ins stay external.
  { entry: 'src/service/main.ts', out: 'service/main.js', node: true },
];

for (const target of targets) {
  const result = await Bun.build({
    entrypoints: [resolve(target.entry)],
    format: target.node ? 'esm' : 'iife',
    target: target.node ? 'node' : 'browser',
    minify: !target.node,
  });
  const artifact = result.outputs[0];
  if (!result.success || !artifact) {
    console.error(result.logs.map((log) => log.message).join('\n') || `Build failed: ${target.entry}`);
    process.exit(1);
  }
  await writeFile(resolve(target.out), await artifact.text());
  console.log(`${target.out}  ${(artifact.size / 1024).toFixed(1)} KB`);
}
