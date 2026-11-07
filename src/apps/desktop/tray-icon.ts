/**
 * 16 pt template icon drawn at build/launch time from the avatar's own neutral body silhouette
 * (no brand image): black pixels with alpha, face holes cut out. Rendered at 2x (32 px).
 */
import { nativeImage } from 'electron';
import type { NativeImage } from 'electron';

const NEUTRAL = [8, 16, 16, 22, 22, 22, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 26, 26, 26, 26, 22, 22, 22, 16, 16, 8];

export function createTrayIcon(): NativeImage {
  const size = 32;
  const px = new Uint8Array(size * size * 4);
  const set = (x: number, y: number, a: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = a;
  };
  const cx = 16;
  const top = 2;
  NEUTRAL.forEach((w, row) => {
    for (let x = 0; x < w; x++) set(cx - Math.floor(w / 2) + x, top + row, 255);
  });
  // face holes: two eyes and a small mouth, as in the avatar
  for (const ex of [cx - 6, cx + 4]) for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) set(ex + x, 13 + y, 0);
  for (let x = 0; x < 4; x++) set(cx - 2 + x, 19, 0);
  const image = nativeImage.createFromBitmap(Buffer.from(px.buffer), { width: size, height: size, scaleFactor: 2 });
  image.setTemplateImage(true);
  return image;
}
