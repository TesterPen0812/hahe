// Tiny PNG encoder + procedural demo pictures, so seeding needs no image files.
// Node-only (scripts), never imported by shared/.
import { crc32, deflateSync } from 'node:zlib';

export interface Picture { width: number; height: number; rgba: Uint8Array }

export function encodePng({ width, height, rgba }: Picture): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array()),
  ]));
}

type Shader = (x: number, y: number) => [number, number, number];

function paint(width: number, height: number, shade: Shader): Picture {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = shade(x / width, y / height);
    const i = (y * width + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return { width, height, rgba };
}

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * Math.min(1, Math.max(0, t)));
const noise = (x: number, y: number) => (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;

export const SCENES = {
  harbour: (w = 480, h = 360) => paint(w, h, (x, y) => {
    if (y < 0.55) { // dusk sky with a sun
      const d = Math.hypot(x - 0.7, y - 0.42);
      if (d < 0.06) return [255, 214, 140];
      return [mix(250, 70, y / 0.55), mix(150, 60, y / 0.55), mix(90, 130, y / 0.55)];
    }
    const boat = x > 0.2 && x < 0.38 && y > 0.5 && y < 0.6 && (y - 0.5) * 2 < (x - 0.2);
    if (boat) return [40, 30, 35];
    const ripple = Math.sin(y * 120 + x * 8) * 12;
    return [mix(60, 20, y) + ripple, mix(70, 30, y) + ripple, mix(120, 70, y) + ripple];
  }),
  market: (w = 480, h = 360) => paint(w, h, (x, y) => {
    if (y > 0.75) return [mix(120, 90, y), 110, 100];                  // street
    const stall = Math.floor(x * 6);
    const awning = y > 0.35 && y < 0.45;
    if (awning) return (Math.floor(x * 30) % 2) ? [220, 60, 50] : [240, 240, 230];
    if (y > 0.45) return [[200, 160, 60], [90, 160, 70], [230, 120, 40], [160, 60, 120], [80, 140, 200], [210, 190, 90]][stall] as [number, number, number];
    return [mix(170, 120, y * 2), mix(200, 160, y * 2), 235];         // sky
  }),
  park: (w = 480, h = 360) => paint(w, h, (x, y) => {
    const tree = Math.hypot(x - 0.3, y - 0.38) < 0.17 || Math.hypot(x - 0.72, y - 0.45) < 0.12;
    if (tree) return [40 + noise(x, y) * 30, 110 + noise(y, x) * 40, 50];
    if ((Math.abs(x - 0.3) < 0.02 && y > 0.5 && y < 0.7) || (Math.abs(x - 0.72) < 0.015 && y > 0.55 && y < 0.7)) return [90, 60, 40];
    if (y > 0.65) return [mix(110, 70, y), mix(170, 130, y), 70];
    return [140, 190, 240];
  }),
  mountains: (w = 480, h = 360) => paint(w, h, (x, y) => {
    const ridge1 = 0.45 + 0.15 * Math.abs(Math.sin(x * 7)) - 0.1 * Math.sin(x * 3);
    const ridge2 = 0.6 + 0.08 * Math.sin(x * 13 + 1);
    if (y > ridge2) return [mix(70, 40, y), mix(100, 70, y), 60];      // forest
    if (y > ridge1) return y < ridge1 + 0.03 ? [245, 245, 250] : [110, 115, 140]; // snowy peaks
    return [mix(120, 200, y * 2), mix(170, 220, y * 2), 250];          // sky
  }),
  lighthouse: (w = 480, h = 360) => paint(w, h, (x, y) => {
    const tower = Math.abs(x - 0.62) < 0.035 + (y - 0.25) * 0.05 && y > 0.25 && y < 0.7;
    if (tower) return Math.floor(y * 12) % 2 ? [220, 40, 40] : [245, 245, 240];
    if (Math.abs(x - 0.62) < 0.04 && y > 0.18 && y <= 0.25) return [255, 230, 120];
    if (y > 0.7) return x > 0.45 && x < 0.8 && y < 0.78 ? [90, 80, 70] : [30, 70, 120 + 20 * Math.sin(x * 50)];
    return [mix(40, 120, y * 1.4), mix(50, 140, y * 1.4), mix(110, 200, y * 1.4)];
  }),
  synthetic: (w = 480, h = 360) => paint(w, h, (x, y) => {  // "too perfect" AI-looking swirl
    const a = Math.atan2(y - 0.5, x - 0.5), r = Math.hypot(x - 0.5, y - 0.5);
    const t = Math.sin(a * 5 + r * 30);
    return [mix(120, 250, t), mix(40, 120, r * 2), mix(200, 255, -t)];
  }),
};

/** Brighten every pixel (an "adjust brightness" edit). */
export function brighten(p: Picture, amount: number): Picture {
  const rgba = new Uint8Array(p.rgba);
  for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) rgba[i + c] = Math.min(255, rgba[i + c] + amount);
  return { ...p, rgba };
}

/** Crop to a rectangle given as fractions of the image. */
export function crop(p: Picture, fx: number, fy: number, fw: number, fh: number): Picture {
  const x0 = Math.floor(fx * p.width), y0 = Math.floor(fy * p.height);
  const width = Math.floor(fw * p.width), height = Math.floor(fh * p.height);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(p.rgba.subarray(((y0 + y) * p.width + x0) * 4, ((y0 + y) * p.width + x0 + width) * 4), y * width * 4);
  return { width, height, rgba };
}

/** Paint a solid box over part of the picture (a content-altering "remove object" edit / tamper). */
export function paintBox(p: Picture, fx: number, fy: number, fw: number, fh: number, rgb: [number, number, number]): Picture {
  const rgba = new Uint8Array(p.rgba);
  for (let y = Math.floor(fy * p.height); y < Math.floor((fy + fh) * p.height); y++) {
    for (let x = Math.floor(fx * p.width); x < Math.floor((fx + fw) * p.width); x++) {
      const i = (y * p.width + x) * 4;
      rgba[i] = rgb[0]; rgba[i + 1] = rgb[1]; rgba[i + 2] = rgb[2];
    }
  }
  return { ...p, rgba };
}
