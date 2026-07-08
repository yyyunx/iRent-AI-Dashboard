export interface BlurResult {
  variance: number;
  wallTime: number;
  isBlur: boolean;
}

/**
 * Calculates the variance of Laplacian over Gaussian (LoG) for blur detection.
 * The image is normalized to 480p (shorter dimension is 480px) before processing.
 * 
 * @param imageSrc Base64 or URL of the image.
 * @param threshold Threshold below which an image is considered blurry. Default is 12.0.
 */
export function checkBlurScore(imageSrc: string, threshold = 12.0): Promise<BlurResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const startTime = performance.now();
        
        const originalWidth = img.naturalWidth || img.width;
        const originalHeight = img.naturalHeight || img.height;
        if (originalWidth === 0 || originalHeight === 0) {
          resolve({ variance: 0, wallTime: 0, isBlur: true });
          return;
        }

        // Scale down so that the shorter dimension is 480px, aspect-ratio preserved
        let targetWidth = originalWidth;
        let targetHeight = originalHeight;

        if (originalWidth < originalHeight) {
          targetWidth = 480;
          targetHeight = Math.round((originalHeight * 480) / originalWidth);
        } else {
          targetHeight = 480;
          targetWidth = Math.round((originalWidth * 480) / originalHeight);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Failed to get 2D context for canvas"));
          return;
        }

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imgData.data;
        const w = imgData.width;
        const h = imgData.height;

        // 1. Grayscale Conversion (Luminance formula)
        const gray = new Float32Array(w * h);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

        // 2. Gaussian Blur (5x5 kernel approximation, sigma = 1.0)
        // Kernel:
        // [ 1,  4,  7,  4, 1 ]
        // [ 4, 16, 26, 16, 4 ]
        // [ 7, 26, 41, 26, 7 ]
        // [ 4, 16, 26, 16, 4 ]
        // [ 1,  4,  7,  4, 1 ] / 273
        const gBlur = new Float32Array(w * h);
        const gk = [
          1,  4,  7,  4, 1,
          4, 16, 26, 16, 4,
          7, 26, 41, 26, 7,
          4, 16, 26, 16, 4,
          1,  4,  7,  4, 1
        ];
        const gw = 273;

        for (let y = 2; y < h - 2; y++) {
          const rowOffset = y * w;
          for (let x = 2; x < w - 2; x++) {
            let sum = 0;
            let kIdx = 0;
            for (let ky = -2; ky <= 2; ky++) {
              const kyOffset = (y + ky) * w;
              for (let kx = -2; kx <= 2; kx++) {
                sum += gray[kyOffset + (x + kx)] * gk[kIdx++];
              }
            }
            gBlur[rowOffset + x] = sum / gw;
          }
        }

        // 3. Laplacian Filter (3x3 kernel)
        // Kernel:
        // [ 0,  1,  0 ]
        // [ 1, -4,  1 ]
        // [ 0,  1,  0 ]
        const lap = new Float32Array(w * h);
        let sumLap = 0;
        let count = 0;

        // Skip border of 3 to avoid edge artifacts from blur + laplacian operations
        for (let y = 3; y < h - 3; y++) {
          const rowOffset = y * w;
          for (let x = 3; x < w - 3; x++) {
            const idx = rowOffset + x;
            const val = gBlur[idx - w] + gBlur[idx - 1] + gBlur[idx + 1] + gBlur[idx + w] - 4 * gBlur[idx];
            lap[idx] = val;
            sumLap += val;
            count++;
          }
        }

        // 4. Variance of Laplacian calculation
        const meanLap = sumLap / count;
        let sumSqDiff = 0;
        for (let y = 3; y < h - 3; y++) {
          const rowOffset = y * w;
          for (let x = 3; x < w - 3; x++) {
            const diff = lap[rowOffset + x] - meanLap;
            sumSqDiff += diff * diff;
          }
        }

        const variance = sumSqDiff / count;
        const wallTime = performance.now() - startTime;

        resolve({
          variance: Number(variance.toFixed(3)),
          wallTime: Number(wallTime.toFixed(3)),
          isBlur: variance < threshold
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for blur check"));
    img.src = imageSrc;
  });
}
