// Build, then run the Electron screenshot harness (dist/desktop/shots.cjs) with the dev mock, then compose the
// strips and compare the regenerated states with the committed PNGs (python3 + Pillow; skipped when missing).
// Output: docs/runs/2026-11-07-overnight/screenshots/*.png, column/, companion/ (frames + strips), entrance/,
// checks.json and compare.json.
// Env: KT_SHOTS_OUT (output dir), KT_SHOTS_HIDDEN=1 (never show the window; uses capturePage only; frame stats
// are then meaningless), KT_SHOTS_ENTRANCE=0 (skip the entrance frames).
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.env.KT_SHOTS_OUT ?? join(root, 'docs/runs/2026-11-07-overnight/screenshots'));

/**
 * Strip composition and baseline comparison, run as `python3 -I -c POST <outDir> <repoRoot> <mode>`.
 * strips: every `strips.json` under outDir lists frames (paths relative to that file), each with its CSS size and
 * an optional crop box in CSS px; frames are scaled by `scale`, consecutive duplicates dropped when `dedupe`,
 * evenly subsampled to `maxFrames`, and joined left to right.
 * compare: every `NN-*.png` in outDir (and column/, which repeats the 420 walk) against `git show HEAD:<path>`
 * of the same file name in outDir; writes compare.json with the changed-pixel share and the bounding box.
 */
export const POST = String.raw`
import io, json, os, re, subprocess, sys
from PIL import Image, ImageChops

out, root, mode = sys.argv[1], sys.argv[2], sys.argv[3]

def compose(spec_path):
    base = os.path.dirname(spec_path)
    for spec in json.load(open(spec_path)):
        imgs = []
        for f in spec['frames']:
            im = Image.open(os.path.join(base, f['file'])).convert('RGB')
            s = im.width / f['css'][0]
            if f.get('box'):
                l, t, r, b = f['box']
                im = im.crop((round(l * s), round(t * s), round(r * s), round(b * s)))
            if spec['scale'] != 1:
                im = im.resize((round(im.width * spec['scale']), round(im.height * spec['scale'])), Image.LANCZOS)
            if spec.get('dedupe') and imgs and imgs[-1].size == im.size and imgs[-1].tobytes() == im.tobytes():
                continue
            imgs.append(im)
        n = spec.get('maxFrames') or len(imgs)
        if len(imgs) > n:
            idx = sorted({round(i * (len(imgs) - 1) / (n - 1)) for i in range(n)})
            imgs = [imgs[i] for i in idx]
        h = max(i.height for i in imgs)
        strip = Image.new('RGB', (sum(i.width for i in imgs), h), (233, 236, 238))
        x = 0
        for i in imgs:
            strip.paste(i, (x, h - i.height))
            x += i.width
        strip.save(os.path.join(base, spec['out']))
        print('[post] strip', os.path.relpath(os.path.join(base, spec['out']), root), len(imgs), 'frames', strip.size)

for d, _, files in os.walk(out):
    if 'strips.json' in files:
        compose(os.path.join(d, 'strips.json'))

def head(rel):
    r = subprocess.run(['git', '-C', root, 'show', 'HEAD:' + rel], capture_output=True)
    return Image.open(io.BytesIO(r.stdout)).convert('RGBA') if r.returncode == 0 else None

result = {}
for sub in ['', 'column']:
    d = os.path.join(out, sub)
    if not os.path.isdir(d):
        continue
    for f in sorted(os.listdir(d)):
        if not re.match(r'^\d\d-.*\.png$', f):
            continue
        new = Image.open(os.path.join(d, f)).convert('RGBA')
        old = head(os.path.relpath(os.path.join(out, f), root))
        key = os.path.join(sub, f) if sub else f
        if old is None:
            result[key] = {'status': 'new', 'size': new.size}
        elif old.size != new.size:
            result[key] = {'status': 'size-changed', 'old': old.size, 'new': new.size}
        else:
            diff = ImageChops.difference(old, new).convert('L').point(lambda v: 255 if v else 0)
            changed = diff.histogram()[255]
            box = diff.getbbox()
            result[key] = {'status': 'same' if not box else 'changed', 'changedPct': round(100 * changed / (new.width * new.height), 3), 'bbox': box}
json.dump(result, open(os.path.join(out, 'compare.json' if mode == 'mock' else 'compare-real.json'), 'w'), indent=1)
counts = {}
for v in result.values():
    counts[v['status']] = counts.get(v['status'], 0) + 1
print('[post] compare with HEAD:', counts)
`;

/** Compose strips and compare with HEAD; a missing python3 / Pillow only skips this step. */
export function post(dir, mode) {
  const r = spawnSync('python3', ['-I', '-c', POST, dir, root, mode], { stdio: 'inherit' });
  if (r.error || r.status !== 0) console.warn('[post] skipped or failed (python3 with Pillow is needed for strips and compare.json)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./build.mjs');
  const electron = createRequire(import.meta.url)('electron');
  const env = { ...process.env, KT_MOCK: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [join(root, 'dist/desktop/shots.cjs')], { stdio: 'inherit', env });
  child.on('exit', (code) => {
    if (code === 0) post(outDir, 'mock');
    process.exit(code ?? 0);
  });
}
