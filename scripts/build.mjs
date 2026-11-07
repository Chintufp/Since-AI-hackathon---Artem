// Bundles the desktop app: dist/desktop/{main.cjs,preload.cjs,renderer.js,index.html,styles.css}
// plus shots.cjs (screenshot harness entry). Usage: node scripts/build.mjs [--watch-free]
import { build } from 'esbuild';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist/desktop');
await mkdir(out, { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'node24' };
const t0 = performance.now();
await Promise.all([
  build({ ...common, entryPoints: [join(root, 'src/apps/desktop/main.ts')], outfile: join(out, 'main.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(root, 'src/apps/desktop/shots.ts')], outfile: join(out, 'shots.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(root, 'src/apps/desktop/preload.ts')], outfile: join(out, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, target: 'chrome140', entryPoints: [join(root, 'src/apps/desktop/renderer.ts')], outfile: join(out, 'renderer.js'), platform: 'browser', format: 'iife', minify: true }),
]);
await copyFile(join(root, 'src/apps/desktop/index.html'), join(out, 'index.html'));
// brand logos for the Connections page (local files; the page cannot load remote images)
await mkdir(join(out, 'logos'), { recursive: true });
for (const f of await readdir(join(root, 'src/apps/desktop/logos'))) if (f.endsWith('.svg')) await copyFile(join(root, 'src/apps/desktop/logos', f), join(out, 'logos', f));
await copyFile(join(root, 'src/libs/utils/ui/styles.css'), join(out, 'styles.css'));
console.log(`built dist/desktop in ${Math.round(performance.now() - t0)} ms`);
