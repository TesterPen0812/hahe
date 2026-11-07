// Perceptual "difference hash": a visual fingerprint that survives
// re-saving, resizing and metadata stripping (unlike a SHA-256 hash).
//
// Input: a 9-wide × 8-tall greyscale image (72 values, 0–255), row by row.
// The client (image.ts) shrinks the photo to 9×8 greyscale and calls this.
// Output: 64 bits as 16 hex characters.

export function dHashFromGrey9x8(pixels: ArrayLike<number>): string {
  if (pixels.length !== 72) throw new Error(`dHash needs 72 pixels (9×8), got ${pixels.length}`);
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/**
 * Shrink any RGBA image to 9×8 greyscale (simple box average) and dHash it.
 * Works with canvas ImageData in the browser or decoded pixels on the server.
 */
export function dHashFromRgba(rgba: ArrayLike<number>, width: number, height: number): string {
  const grey: number[] = [];
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 9; gx++) {
      const x0 = Math.floor((gx * width) / 9), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / 9));
      const y0 = Math.floor((gy * height) / 8), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / 8));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
        n++;
      }
      grey.push(sum / n);
    }
  }
  return dHashFromGrey9x8(grey);
}

/** Number of differing bits between two dHashes (0 = identical, 64 = opposite). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  while (x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

/** Distance of 10 or less counts as "the same picture". */
export const DHASH_MATCH_THRESHOLD = 10;
