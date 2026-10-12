import crypto from 'crypto';
import sharp from 'sharp';
import { DamageEvent, PersistedDamageResult } from './InspectionModels';

const DEFAULT_TTL_SECONDS = 10 * 60;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
}

export function verifiedDamageEvents(aiResultJson: string | null | undefined): DamageEvent[] {
  try {
    const damage = JSON.parse(aiResultJson || '{}').damage as PersistedDamageResult | undefined;
    if (damage?.schema_version !== 'irent.damage.v1' || damage.vlm?.status !== 'success' || !Array.isArray(damage.events)) return [];
    return damage.events.filter(event => event?.damage?.verification?.is_damage === true);
  } catch {
    return [];
  }
}

export async function renderDamageAnnotations(input: Buffer, events: DamageEvent[]): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const sourcePixelWidth = metadata.width || 0;
  const sourcePixelHeight = metadata.height || 0;
  if (!sourcePixelWidth || !sourcePixelHeight) throw new Error('Invalid source image');
  const outputScale = Math.min(1, 2048 / sourcePixelWidth, 2048 / sourcePixelHeight);
  const width = Math.max(1, Math.round(sourcePixelWidth * outputScale));
  const height = Math.max(1, Math.round(sourcePixelHeight * outputScale));

  const boxes = events.flatMap(event => {
    const bbox = event?.damage?.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return [];
    const sourceWidth = Number(event.image?.width);
    const sourceHeight = Number(event.image?.height);
    if (sourceWidth <= 0 || sourceHeight <= 0) return [];
    const x1 = Math.max(0, Math.min(width, bbox[0] * width / sourceWidth));
    const y1 = Math.max(0, Math.min(height, bbox[1] * height / sourceHeight));
    const x2 = Math.max(0, Math.min(width, bbox[2] * width / sourceWidth));
    const y2 = Math.max(0, Math.min(height, bbox[3] * height / sourceHeight));
    if (x2 <= x1 || y2 <= y1) return [];
    const label = `${event.damage.type} ${Math.round(event.damage.verification.confidence * 100)}%`;
    const labelWidth = Math.min(width - x1, Math.max(110, label.length * 15));
    const labelY = Math.max(0, y1 - 30);
    return [`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="none" stroke="#d71920" stroke-width="${Math.max(3, width / 300)}"/>`
      + `<rect x="${x1}" y="${labelY}" width="${labelWidth}" height="30" fill="#d71920"/>`
      + `<text x="${x1 + 6}" y="${labelY + 21}" fill="white" font-family="sans-serif" font-size="18" font-weight="700">${escapeXml(label)}</text>`];
  });
  if (!boxes.length) throw new Error('No verified damage annotations');
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${boxes.join('')}</svg>`);
  return sharp(input).resize({ width, height, fit: 'fill' }).composite([{ input: overlay }]).jpeg({ quality: 88 }).toBuffer();
}

function signature(photoId: string, expires: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${photoId}.${expires}`).digest('base64url');
}

export function createSignedLineImageUrl(photoId: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const secret = process.env.LINE_IMAGE_SIGNING_SECRET || '';
  if (!/^https:\/\//i.test(publicBaseUrl) || secret.length < 32) return null;
  const configuredTtl = Number(process.env.LINE_IMAGE_URL_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  const ttl = Number.isFinite(configuredTtl) ? Math.min(Math.max(configuredTtl, 60), 3600) : DEFAULT_TTL_SECONDS;
  const expires = nowSeconds + ttl;
  return `${publicBaseUrl}/api/line-images/${encodeURIComponent(photoId)}?expires=${expires}&signature=${signature(photoId, expires, secret)}`;
}

export function verifySignedLineImage(photoId: string, expiresValue: unknown, suppliedSignature: unknown, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const secret = process.env.LINE_IMAGE_SIGNING_SECRET || '';
  const expires = Number(expiresValue);
  const supplied = String(suppliedSignature || '');
  if (secret.length < 32 || !Number.isInteger(expires) || expires < nowSeconds || expires > nowSeconds + 3600 || !supplied) return false;
  const expected = signature(photoId, expires, secret);
  return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
