const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createSignedLineImageUrl, renderDamageAnnotations, verifiedDamageEvents, verifySignedLineImage } = require('../dist/services/DamageAnnotations');

const verifiedEvent = {
  id: 'damage-1',
  damage: { type: 'scratch', confidence: 0.8, bbox: [10, 20, 60, 70], center2D: [35, 45], verification: { candidate_id: 0, source_index: 0, is_damage: true, damage_type: 'scratch', confidence: 0.9, reason: 'visible' } },
  localization: { success: false }, image: { width: 100, height: 100 }, createdAt: new Date().toISOString()
};

test('keeps only Qwen-confirmed events from a successful review', () => {
  const json = JSON.stringify({ damage: { schema_version: 'irent.damage.v1', vlm: { status: 'success' }, events: [verifiedEvent, { ...verifiedEvent, id: 'rejected', damage: { ...verifiedEvent.damage, verification: { ...verifiedEvent.damage.verification, is_damage: false } } }] } });
  assert.deepEqual(verifiedDamageEvents(json).map(event => event.id), ['damage-1']);
  assert.deepEqual(verifiedDamageEvents(JSON.stringify({ damage: { schema_version: 'irent.damage.v1', vlm: { status: 'unavailable' }, events: [verifiedEvent] } })), []);
});

test('renders a scaled annotation without changing the source file', async () => {
  const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } }).png().toBuffer();
  const annotated = await renderDamageAnnotations(source, [verifiedEvent]);
  const metadata = await sharp(annotated).metadata();
  assert.equal(metadata.width, 200);
  assert.equal(metadata.height, 100);
  assert.equal(metadata.format, 'jpeg');
  assert.equal((await sharp(source).metadata()).format, 'png');
});

for (const orientation of [1, 3, 6, 8]) {
  test(`keeps annotation coordinates aligned for normalized EXIF Orientation ${orientation}`, async () => {
    const source = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'white' } })
      .jpeg().withMetadata({ orientation }).toBuffer();
    const normalized = await sharp(source).autoOrient().jpeg().toBuffer();
    const normalizedMetadata = await sharp(normalized).metadata();
    const width = normalizedMetadata.width;
    const height = normalizedMetadata.height;
    const event = {
      ...verifiedEvent,
      damage: { ...verifiedEvent.damage, bbox: [width * 0.1, height * 0.2, width * 0.6, height * 0.7] },
      image: { width, height }
    };

    const annotated = await renderDamageAnnotations(normalized, [event]);
    const metadata = await sharp(annotated).metadata();
    const { data, info } = await sharp(annotated).raw().toBuffer({ resolveWithObject: true });
    const borderX = Math.round(width * 0.1);
    const borderY = Math.round(height * 0.45);
    const borderOffset = (borderY * info.width + borderX) * info.channels;

    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
    assert.equal(metadata.orientation, undefined);
    assert.ok(data[borderOffset] > data[borderOffset + 1] + 80, 'bbox border remains at the normalized coordinate');
  });
}

test('signed LINE image URLs require HTTPS and expire', () => {
  process.env.PUBLIC_BASE_URL = 'https://dashboard.example.com';
  process.env.LINE_IMAGE_SIGNING_SECRET = 'a'.repeat(32);
  process.env.LINE_IMAGE_URL_TTL_SECONDS = '600';
  const url = createSignedLineImageUrl('PHOTO-1', 1000);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(verifySignedLineImage('PHOTO-1', parsed.searchParams.get('expires'), parsed.searchParams.get('signature'), 1001), true);
  assert.equal(verifySignedLineImage('PHOTO-1', parsed.searchParams.get('expires'), parsed.searchParams.get('signature'), 1601), false);
  assert.equal(verifySignedLineImage('PHOTO-2', parsed.searchParams.get('expires'), parsed.searchParams.get('signature'), 1001), false);
});
