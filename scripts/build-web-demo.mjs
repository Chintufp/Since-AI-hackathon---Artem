// Builds the static web preview (real panel + mock API, no service): dist/web-demo/{index.html,app.js,styles.css}.
// Usage: node scripts/build-web-demo.mjs [outDir]
import { build } from 'esbuild';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'dist/web-demo'));
await mkdir(out, { recursive: true });
await build({
  entryPoints: [join(root, 'src/apps/web-demo/main.ts')],
  outfile: join(out, 'app.js'),
  bundle: true, minify: true, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'warning',
});
await copyFile(join(root, 'src/apps/web-demo/index.html'), join(out, 'index.html'));
await copyFile(join(root, 'src/libs/utils/ui/styles.css'), join(out, 'styles.css'));
await mkdir(join(out, 'logos'), { recursive: true });
for (const f of await readdir(join(root, 'src/apps/desktop/logos'))) if (f.endsWith('.svg')) await copyFile(join(root, 'src/apps/desktop/logos', f), join(out, 'logos', f));
console.log(`built ${out}`);
