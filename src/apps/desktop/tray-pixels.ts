/**
 * 16 pt tray icon pixels drawn at build/launch time from the avatar's own neutral body silhouette (no brand image).
 * macOS: a template image (black pixels with alpha, face holes cut out; the menu bar tints it).
 * Windows / Linux: no template tinting, and the taskbar is usually dark, so a white body with a grey rim and dark
 * eyes and mouth, like Lumi himself. Rendered at 2x (32 px).
 */

const NEUTRAL = [8, 16, 16, 22, 22, 22, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 26, 26, 26, 26, 22, 22, 22, 16, 16, 8];
type RGBA = [number, number, number, number];

/** The icon's pixels (32 × 32 RGBA). Pure, so it is testable without Electron. */
export function trayIconPixels(platform: string): Uint8Array {
  const size = 32;
  const template = platform === 'darwin';
  const body: RGBA = template ? [0, 0, 0, 255] : [255, 255, 255, 255];
  const rim: RGBA = template ? body : [154, 170, 184, 255];
  const face: RGBA = template ? [0, 0, 0, 0] : [36, 53, 66, 255];
  const px = new Uint8Array(size * size * 4);
  const set = (x: number, y: number, c: RGBA): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    px.set(c, (y * size + x) * 4);
  };
  const cx = 16;
  const top = 2;
  NEUTRAL.forEach((w, row) => {
    const left = cx - Math.floor(w / 2);
    for (let x = 0; x < w; x++) set(left + x, top + row, body);
  });
  // a one-pixel rim where the body meets transparency (no-op on macOS, where rim = body)
  if (!template) {
    const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size && y < size && px[(y * size + x) * 4 + 3] > 0;
    const edge: Array<[number, number]> = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (solid(x, y) && (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))) edge.push([x, y]);
    for (const [x, y] of edge) set(x, y, rim);
  }
  // face: two eyes and a small mouth, as in the avatar
  for (const ex of [cx - 6, cx + 4]) for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) set(ex + x, 13 + y, face);
  for (let x = 0; x < 4; x++) set(cx - 2 + x, 19, face);
  return px;
}
