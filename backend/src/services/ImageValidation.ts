import sharp from 'sharp';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_IMAGE_SIDE = 8_000;

type ImageFormat = 'jpeg' | 'png' | 'webp';

function detectedFormat(buffer: Buffer): ImageFormat | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

export async function validateImageDataUrl(dataUrl: string): Promise<{ buffer: Buffer; extension: string }> {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new Error('Invalid image payload');

  const declaredFormat = match[1].toLowerCase() as ImageFormat;
  const base64 = match[2].replace(/[\r\n]/g, '');
  if (Math.floor(base64.length * 0.75) > MAX_FILE_BYTES) throw new Error('Image exceeds 10 MB limit');

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('Invalid image payload');
  const magicFormat = detectedFormat(buffer);
  if (!magicFormat || magicFormat !== declaredFormat) throw new Error('Image MIME type does not match file signature');

  try {
    const decoder = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS, animated: false });
    const metadata = await decoder.metadata();
    if (metadata.format !== magicFormat || !metadata.width || !metadata.height) throw new Error('Invalid image payload');
    if (metadata.width > MAX_IMAGE_SIDE || metadata.height > MAX_IMAGE_SIDE || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new Error('Image dimensions exceed limit');
    }
    // Force pixel decode; metadata alone does not prove the complete image stream is valid.
    await decoder.raw().toBuffer();
  } catch (error: any) {
    if (error?.message === 'Image dimensions exceed limit') throw error;
    throw new Error('Image decode failed');
  }

  return { buffer, extension: magicFormat === 'jpeg' ? '.jpg' : `.${magicFormat}` };
}
