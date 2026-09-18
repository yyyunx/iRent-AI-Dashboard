const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');

const { varianceOfLaplacian } = require('../src/services/Laplacian');

function checkerboard(width, height, cellSize = 2) {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2) * 255;
    }
  }
  return pixels;
}

test('variance of Laplacian separates a sharp edge pattern from a flat blurred image', () => {
  const sharp = checkerboard(32, 32);
  const flat = new Uint8Array(32 * 32).fill(128);
  assert.ok(varianceOfLaplacian(sharp, 32, 32) > 100);
  assert.equal(varianceOfLaplacian(flat, 32, 32), 0);
});

test('variance of Laplacian rejects images too small for a 3x3 kernel', () => {
  assert.throws(() => varianceOfLaplacian(new Uint8Array(4), 2, 2), /too small/);
});
