/** Minimal drawing surface the pixel kit needs; satisfied by CanvasRenderingContext2D and by test fakes. */
export interface DrawTarget {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

export interface ActBeat {
  frame: number;
  label: string;
}

/** One authored animation: a pure function of the frame index onto a 96x96 scene. */
export interface Act {
  label: string;
  fps: number;
  frames: number;
  stillFrame: number;
  beats: ActBeat[];
  render(c: DrawTarget, frame: number): void;
}

export type Palette = Readonly<Record<'body' | 'edge' | 'shade' | 'nub' | 'ink' | 'cheek' | 'shadow' | 'accent' | 'star', string>>;

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface HandSpec {
  side: number;
  pose?: string;
  level?: number;
}

export type FootSpec = number | { side: number; lift?: number };

export interface OrbSpec {
  x?: number;
  bottom?: number;
  shape?: string;
  expression?: string;
  gaze?: number;
  view?: string;
  turn?: number;
  hands?: HandSpec[];
  feet?: FootSpec[];
}

export interface Kit {
  palette: Palette;
  shapes: Readonly<Record<string, readonly number[]>>;
  clear(c: DrawTarget): void;
  shadow(c: DrawTarget, o?: { x?: number; y?: number; width?: number }): void;
  orb(c: DrawTarget, o?: OrbSpec): Bounds;
  pixel(c: DrawTarget, x: number, y: number, w: number, h: number, color: string): void;
  line(c: DrawTarget, points: Array<[number, number]>, color?: string): void;
  star(c: DrawTarget, x: number, y: number, color?: string): void;
}
