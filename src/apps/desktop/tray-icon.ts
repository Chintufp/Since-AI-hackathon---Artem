/** The tray icon as an Electron image; the pixels (and why they differ per platform) are in tray-pixels.ts. */
import { nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import { trayIconPixels } from './tray-pixels.ts';

export function createTrayIcon(platform: string = process.platform): NativeImage {
  const px = trayIconPixels(platform);
  const image = nativeImage.createFromBitmap(Buffer.from(px.buffer), { width: 32, height: 32, scaleFactor: 2 });
  if (platform === 'darwin') image.setTemplateImage(true);
  return image;
}
