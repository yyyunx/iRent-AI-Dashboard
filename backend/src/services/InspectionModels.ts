import { validateImageDataUrl } from './ImageValidation';

export type OrientationAngle = 0 | 90 | 180 | 270;

export interface OrientationAnalysis {
  angle: OrientationAngle;
  label: 'upright' | 'rotate_90_cw' | 'upside_down' | 'rotate_90_ccw';
  confidence: number;
  passed: boolean;
  suggestedRotation: OrientationAngle;
}

export interface VehicleConditionAnalysis {
  damage: { detected: boolean; confidence: number; type?: 'scratch' | 'dent' | 'crack' | 'broken' | 'paint_damage' | 'unknown' };
  dirty: { detected: boolean; confidence: number };
  abnormal: boolean;
}

export class InspectionModelError extends Error {
  constructor(public readonly code: 'ORIENTATION_MODEL_UNAVAILABLE' | 'DAMAGE_MODEL_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'InspectionModelError';
  }
}

export function isFeatureEnabled(name: 'ORIENTATION_CHECK_ENABLED' | 'CONDITION_CHECK_ENABLED'): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || ''));
}

/**
 * Stable model boundary. The application deliberately does not infer a result until a
 * deployed vehicle-orientation model is wired here; returning an invented pass would
 * turn a quality gate into a security and operations blind spot.
 */
export async function analyzeOrientation(imageData: string): Promise<OrientationAnalysis> {
  await validateImageDataUrl(imageData);
  throw new InspectionModelError('ORIENTATION_MODEL_UNAVAILABLE', 'Orientation model is not configured.');
}

/** Same contract-first boundary for the future damage/cleanliness model. */
export async function analyzeVehicleCondition(imageData: string): Promise<VehicleConditionAnalysis> {
  await validateImageDataUrl(imageData);
  throw new InspectionModelError('DAMAGE_MODEL_UNAVAILABLE', 'Damage and cleanliness model is not configured.');
}
