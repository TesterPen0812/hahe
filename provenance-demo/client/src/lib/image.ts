import { dHashFromRgba, sha256Hex } from '@provenance-demo/shared'

/** SHA-256 of the exact bytes that will be uploaded. Never re-encode the file after this. */
export async function hashFile(file: Blob): Promise<{ bytes: Uint8Array; contentHash: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { bytes, contentHash: sha256Hex(bytes) }
}

/** Perceptual fingerprint (dHash) that survives screenshots and re-saves. */
export async function dHashFile(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const w = 90, h = 80
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return dHashFromRgba(ctx.getImageData(0, 0, w, h).data, w, h)
}
