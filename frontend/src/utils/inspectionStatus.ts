export interface PhotoAnalysis {
  inference_status: string;
  damage_status: string;
}

export type InspectionStatus = 'processing' | 'clear' | 'detected' | 'review_required';

export function photoInspectionStatus(damage?: PhotoAnalysis): InspectionStatus {
  if (!damage || ['pending', 'processing', 'running'].includes(damage.inference_status)) return 'processing';
  if (damage.inference_status === 'success' && damage.damage_status === 'none') return 'clear';
  if (damage.inference_status === 'success' && damage.damage_status === 'detected') return 'detected';
  return 'review_required';
}

interface InspectedPhoto {
  status: string;
  photoId?: string;
  quality?: { passed: boolean; blur: { passed: boolean } };
  damage?: PhotoAnalysis;
}

export function canSubmitInspectedPhotos(slots: readonly string[], photos: Record<string, InspectedPhoto>): boolean {
  return slots.length > 0 && slots.every(slot => {
    const photo = photos[slot];
    return photo?.status === 'passed' && Boolean(photo.photoId) && photo.quality?.passed === true
      && photo.quality.blur.passed && Boolean(photo.damage)
      && ['success', 'failed'].includes(photo.damage!.inference_status);
  });
}

export function submissionInspectionStatus(overallStatus: string, unavailablePhotoCount = 0): InspectionStatus {
  if (unavailablePhotoCount > 0) return 'review_required';
  if (overallStatus === 'ok') return 'clear';
  if (overallStatus === 'warning') return 'detected';
  if (['pending', 'processing'].includes(overallStatus)) return 'processing';
  return 'review_required';
}

export const INSPECTION_LABELS: Record<InspectionStatus, string> = {
  processing: '分析中', clear: '無異常', detected: '有異常', review_required: '待人工確認'
};
