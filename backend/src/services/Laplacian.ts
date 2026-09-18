/**
 * Calculates variance of the 4-neighbour Laplacian for a single-channel image.
 * The decoder is intentionally separate so it can be unit-tested without image I/O.
 */
export function varianceOfLaplacian(pixels: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3 || pixels.length < width * height) {
    throw new Error('Image is too small for quality validation');
  }

  let total = 0;
  let totalSquared = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const laplacian = pixels[index - width] + pixels[index - 1] + pixels[index + 1] + pixels[index + width] - 4 * pixels[index];
      total += laplacian;
      totalSquared += laplacian * laplacian;
      samples += 1;
    }
  }
  return Math.max(0, totalSquared / samples - (total / samples) ** 2);
}
