import sharp from 'sharp';
import { varianceOfLaplacian } from './Laplacian';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_IMAGE_SIDE = 8_000;

type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface BlurQualityResult {
  score: number;
  threshold: number;
  passed: boolean;
}

export class ImageQualityError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = 'ImageQualityError';
  }
}

const imageError = (code: string, message: string, status: number) => new ImageQualityError(code, message, status);

export function getBlurThreshold(): number {
  const value = Number(process.env.BLUR_THRESHOLD ?? 100);
  return Number.isFinite(value) && value > 0 ? value : 100;
}

function detectedFormat(buffer: Buffer): ImageFormat | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

async function decodeValidatedImage(dataUrl: string, includeBlurQuality: boolean): Promise<{ buffer: Buffer; extension: string; blur?: BlurQualityResult }> {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw imageError('UNSUPPORTED_IMAGE_TYPE', 'Unsupported image type', 415);

  const declaredFormat = match[1].toLowerCase() as ImageFormat;
  const base64 = match[2].replace(/[\r\n]/g, '');
  if (Math.floor(base64.length * 0.75) > MAX_FILE_BYTES) throw imageError('IMAGE_TOO_LARGE', 'Image exceeds 10 MB limit', 413);

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw imageError('INVALID_IMAGE', 'Invalid image payload', 400);
  if (buffer.length > MAX_FILE_BYTES) throw imageError('IMAGE_TOO_LARGE', 'Image exceeds 10 MB limit', 413);
  const magicFormat = detectedFormat(buffer);
  if (!magicFormat || magicFormat !== declaredFormat) throw imageError('INVALID_IMAGE', 'Image MIME type does not match file signature', 400);

  try {
    const decoder = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS, animated: false });
    const metadata = await decoder.metadata();
    if (metadata.format !== magicFormat || !metadata.width || !metadata.height) throw imageError('INVALID_IMAGE', 'Invalid image payload', 400);
    if (metadata.width > MAX_IMAGE_SIDE || metadata.height > MAX_IMAGE_SIDE || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw imageError('IMAGE_TOO_LARGE', 'Image dimensions exceed limit', 413);
    }
    // Decode once. The quality path reuses these decoded grayscale pixels rather than decoding the
    // upload a second time; it is intentionally bounded to keep uploads responsive on large phones.
    const decoded = await decoder
      .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (!includeBlurQuality) return { buffer, extension: magicFormat === 'jpeg' ? '.jpg' : `.${magicFormat}` };

    const { data, info } = decoded;
    if (info.width < 3 || info.height < 3 || !data.length) {
      throw imageError('INVALID_IMAGE', 'Image is too small for quality validation', 400);
    }

    // Variance of a 4-neighbour Laplacian. Sharp is already installed in this Node backend, so
    // this keeps the authoritative check in-process without a parallel Python service.
    const score = varianceOfLaplacian(data, info.width, info.height);
    const threshold = getBlurThreshold();
    return {
      buffer,
      extension: magicFormat === 'jpeg' ? '.jpg' : `.${magicFormat}`,
      blur: { score: Number(score.toFixed(2)), threshold, passed: score >= threshold }
    };
  } catch (error: any) {
    if (error instanceof ImageQualityError) throw error;
    throw imageError('INVALID_IMAGE', 'Image decode failed', 400);
  }
}

export async function validateImageDataUrl(dataUrl: string): Promise<{ buffer: Buffer; extension: string }> {
  const image = await decodeValidatedImage(dataUrl, false);
  return { buffer: image.buffer, extension: image.extension };
}

export async function analyzeImageQuality(dataUrl: string): Promise<{ buffer: Buffer; extension: string; blur: BlurQualityResult }> {
  const image = await decodeValidatedImage(dataUrl, true);
  return { buffer: image.buffer, extension: image.extension, blur: image.blur! };
}
