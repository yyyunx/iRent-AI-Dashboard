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
  damage: { detected: boolean; confidence: number; type?: 'scratch' | 'dent' | 'crack' | 'broken' | 'other' | 'paint_damage' | 'unknown' };
  dirty: { detected: boolean; confidence: number };
  abnormal: boolean;
  detections: DamageDetection[];
  vlm: VlmVerificationSummary;
}

export interface DamageDetection {
  label_id: 0 | 1 | 2;
  label: 'Scratched' | 'Dented' | 'Broken';
  confidence: number;
  bbox_xyxy: [number, number, number, number];
  verification?: VlmCandidateVerification;
}

export interface DamageEvent {
  id: string;
  damage: { type: string; confidence: number; bbox: [number, number, number, number]; center2D: [number, number]; verification: VlmCandidateVerification };
  localization: {
    success: boolean;
    position3D?: [number, number, number];
    vehiclePart?: string;
    method?: string;
    confidence?: number;
    failureReason?: string;
    ray?: { coordinateFrame: 'Blender vehicle frame'; origin: [number, number, number]; direction: [number, number, number] };
  };
  image: { url?: string; width: number; height: number };
  createdAt: string;
}

export interface VlmCandidateVerification {
  candidate_id: number;
  source_index: number;
  is_damage: boolean;
  damage_type: 'scratch' | 'dent' | 'crack' | 'broken' | 'other' | 'none';
  confidence: number;
  reason: string;
}

export interface VlmVerificationSummary {
  status: 'success' | 'skipped_no_candidates' | 'disabled' | 'unavailable' | 'timeout' | 'failed';
  model: string | null;
  failure_reason: string | null;
  verifications: VlmCandidateVerification[];
  inference_seconds?: number;
}

export interface PersistedDamageResult {
  schema_version: 'irent.damage.v1';
  photoId: string;
  damage_status: 'detected' | 'none' | 'unavailable';
  detection_count: number;
  confidence: number | null;
  detections: DamageDetection[];
  inference_status: 'success' | 'failed';
  failure_reason: string | null;
  vlm: VlmVerificationSummary;
  events: DamageEvent[];
  checked_at: string;
}

export interface KptNetAnalysis {
  schema_version: string;
  bbox_xyxy: [number, number, number, number] | null;
  detection_confidence: number | null;
  keypoints: Record<string, unknown>[];
  final_reliable_keypoints: Record<string, unknown>[];
  reliable_count: number;
  correction_applied_count: number;
  pnp_eligible: boolean;
  [key: string]: unknown;
}

export interface VehicleGateAnalysis {
  schema_version: 'vehicle-gate.v1';
  success: boolean;
  reason: 'NO_VEHICLE_DETECTED' | null;
  bbox_xyxy: [number, number, number, number] | null;
  confidence: number | null;
  class_id: number | null;
}

export interface CaptureGuidanceAnalysis {
  schema_version: 'altis-guidance.v1';
  success: boolean;
  failure_reason: string | null;
  correspondence_count: number;
  inlier_count: number;
  inlier_ratio: number;
  reprojection_error: number | null;
  guidance_status: 'FULL' | 'DEGRADED' | 'UNAVAILABLE';
  solver_used: 'EPNP' | 'AP3P' | 'NONE';
  degradation_reason: string | null;
  view_sector: import('./Coverage').ViewSector | null;
  covered_sectors: import('./Coverage').ViewSector[];
  validation_result: {
    valid: boolean;
    reasons: string[];
    positive_depth_fraction?: number;
    camera_inside_vehicle?: boolean;
    forward_alignment?: number;
    hemisphere_consistent?: boolean;
    minimal_support_only?: boolean;
  };
  rvec?: [number, number, number];
  tvec?: [number, number, number];
  camera_position_car_frame?: [number, number, number];
  yaw?: number;
  pitch?: number;
  roll?: number;
  distance?: number;
  intrinsics: Record<string, unknown> | null;
  viewer_pose?: {
    coordinate_frame: string;
    camera_direction_from_target: [number, number, number];
    camera_up: [number, number, number];
    target_car_frame_blender: [number, number, number];
    axis_conversion: string;
  };
  pose_debug?: {
    rotation_object_to_camera: number[][];
    rotation_camera_to_object: number[][];
    camera_center_car_frame: [number, number, number];
    camera_position_three: [number, number, number];
    target_three: [number, number, number];
    camera_forward_three: [number, number, number];
    camera_up_three: [number, number, number];
  };
  kpt: {
    schema_version?: string;
    detection_confidence: number | null;
    reliable_count: number;
    correction_applied_count: number;
    pnp_eligible: boolean;
  };
  [key: string]: unknown;
}

export class InspectionModelError extends Error {
  constructor(public readonly code: 'ORIENTATION_MODEL_UNAVAILABLE' | 'DAMAGE_MODEL_UNAVAILABLE' | 'KPT_MODEL_UNAVAILABLE' | 'AI_SERVICE_TIMEOUT' | 'AI_SERVICE_ERROR' | 'NO_VEHICLE_DETECTED', message: string) {
    super(message);
    this.name = 'InspectionModelError';
  }
}

function aiServiceUrl(): string {
  return String(process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
}

function aiTimeoutMs(): number {
  const configured = Number(process.env.AI_SERVICE_TIMEOUT_MS || 60_000);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

async function callAiService<T>(path: string, imageData: string): Promise<T> {
  const image = await validateImageDataUrl(imageData);
  const mime = image.extension === '.jpg' ? 'jpeg' : image.extension.slice(1);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiTimeoutMs());
  try {
    const response = await fetch(`${aiServiceUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image_data: `data:image/${mime};base64,${image.buffer.toString('base64')}` }),
      signal: controller.signal
    });
    if (!response.ok) throw new InspectionModelError('AI_SERVICE_ERROR', `AI service returned HTTP ${response.status}.`);
    return await response.json() as T;
  } catch (error: any) {
    if (error instanceof InspectionModelError) throw error;
    if (error?.name === 'AbortError') throw new InspectionModelError('AI_SERVICE_TIMEOUT', 'AI service request timed out.');
    throw new InspectionModelError('AI_SERVICE_ERROR', `AI service unavailable: ${error?.message || 'connection failed'}`);
  } finally {
    clearTimeout(timeout);
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

export async function analyzeVehicleInput(imageData: string): Promise<VehicleGateAnalysis> {
  const result = await callAiService<VehicleGateAnalysis>('/v1/vehicle-gate', imageData);
  if (!result.success || !result.bbox_xyxy) {
    throw new InspectionModelError('NO_VEHICLE_DETECTED', '未偵測到足夠清晰的車輛，請重新拍攝，確保車輛完整入鏡且光線充足。');
  }
  return result;
}

/** Same contract-first boundary for the future damage/cleanliness model. */
export async function analyzeVehicleCondition(imageData: string): Promise<VehicleConditionAnalysis> {
  const raw = await callAiService<{ detections: DamageDetection[]; vlm?: VlmVerificationSummary }>('/v1/damage', imageData);
  const detections = Array.isArray(raw.detections) ? raw.detections : [];
  const fallbackVlm: VlmVerificationSummary = { status: detections.length ? 'unavailable' : 'skipped_no_candidates', model: null, failure_reason: detections.length ? 'QWEN_RESULT_MISSING' : null, verifications: [] };
  const vlm = raw.vlm && Array.isArray(raw.vlm.verifications) ? raw.vlm : fallbackVlm;
  const verificationByIndex = new Map(vlm.verifications.map(item => [item.source_index, item]));
  const verifiedDetections = detections.map((item, index) => ({ ...item, verification: verificationByIndex.get(index) }));
  const actionable = vlm.status === 'success'
    ? verifiedDetections.filter(item => item.verification?.is_damage === true)
    : [];
  const strongest = actionable.reduce<DamageDetection | undefined>((best, item) => !best || item.confidence > best.confidence ? item : best, undefined);
  const types: Record<DamageDetection['label'], NonNullable<VehicleConditionAnalysis['damage']['type']>> = {
    Scratched: 'scratch', Dented: 'dent', Broken: 'broken'
  };
  const verifiedType = strongest?.verification?.damage_type === 'none' ? undefined : strongest?.verification?.damage_type;
  return {
    damage: { detected: Boolean(strongest), confidence: strongest?.confidence || 0, type: verifiedType || (strongest ? types[strongest.label] : undefined) },
    dirty: { detected: false, confidence: 0 },
    abnormal: Boolean(strongest),
    detections: verifiedDetections,
    vlm
  };
}

export async function analyzeCaptureGuidance(imageData: string): Promise<CaptureGuidanceAnalysis> {
  return callAiService<CaptureGuidanceAnalysis>('/v1/guidance', imageData);
}
