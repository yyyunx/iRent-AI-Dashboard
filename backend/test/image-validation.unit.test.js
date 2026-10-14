const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { validateImageDataUrl } = require('../src/services/ImageValidation');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { DashboardService } = require('../src/services/DashboardService');

function dataUrl(mime, buffer) {
  return `data:image/${mime};base64,${buffer.toString('base64')}`;
}

async function expectImageError(promise, code, status) {
  await assert.rejects(promise, error => error.code === code && error.status === status);
}

test('uses the decoded file format for validation and storage when declared MIME differs', async t => {
  const jpeg = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#ffffff' }
  }).jpeg().toBuffer();
  const mismatchedDataUrl = dataUrl('png', jpeg);

  const result = await validateImageDataUrl(mismatchedDataUrl);

  assert.equal(result.extension, '.jpg');
  assert.equal((await sharp(result.buffer).metadata()).format, 'jpeg');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-image-validation-'));
  const uploadDir = path.join(root, 'uploads');
  const repo = new DatabaseRepository(path.join(root, 'test.db'));
  const service = new DashboardService(repo, uploadDir);
  t.after(() => {
    repo.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const storedPath = await service.saveValidatedPhotoFile('photo', 'claimed.png', mismatchedDataUrl);
  assert.equal(path.extname(storedPath), '.jpg');
  assert.equal((await sharp(fs.readFileSync(path.join(root, storedPath))).metadata()).format, 'jpeg');
});

for (const orientation of [1, 3, 6, 8]) {
  test(`normalizes EXIF Orientation ${orientation} into pixels and removes the tag`, async () => {
    const sourceWidth = 40;
    const sourceHeight = 24;
    const source = await sharp({
      create: { width: sourceWidth, height: sourceHeight, channels: 3, background: '#c61f35' }
    }).jpeg().withMetadata({ orientation }).toBuffer();

    const result = await validateImageDataUrl(dataUrl('jpeg', source));
    const metadata = await sharp(result.buffer).metadata();
    const swapsAxes = orientation === 6 || orientation === 8;

    assert.equal(metadata.width, swapsAxes ? sourceHeight : sourceWidth);
    assert.equal(metadata.height, swapsAxes ? sourceWidth : sourceHeight);
    assert.equal(metadata.orientation, undefined);
  });
}

test('normalizes an ordinary image without changing its pixel dimensions', async () => {
  const source = await sharp({
    create: { width: 37, height: 23, channels: 3, background: '#2d78e7' }
  }).png().toBuffer();

  const result = await validateImageDataUrl(dataUrl('png', source));
  const metadata = await sharp(result.buffer).metadata();

  assert.equal(metadata.width, 37);
  assert.equal(metadata.height, 23);
  assert.equal(metadata.orientation, undefined);
});

test('rejects a forged supported-image declaration without a supported signature', async () => {
  await expectImageError(
    validateImageDataUrl(dataUrl('jpeg', Buffer.from('<script>alert(1)</script>'))),
    'INVALID_IMAGE',
    400
  );
});

test('rejects a supported signature that Sharp cannot decode', async () => {
  const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await expectImageError(validateImageDataUrl(dataUrl('webp', truncatedPng)), 'INVALID_IMAGE', 400);
});

test('keeps the 10 MB encoded-file limit', async () => {
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  await expectImageError(validateImageDataUrl(dataUrl('jpeg', oversized)), 'IMAGE_TOO_LARGE', 413);
});

test('keeps the maximum image-side limit', async () => {
  const tooWide = await sharp({
    create: { width: 8001, height: 1, channels: 3, background: '#ffffff' }
  }).png().toBuffer();
  await expectImageError(validateImageDataUrl(dataUrl('png', tooWide)), 'IMAGE_TOO_LARGE', 413);
});
