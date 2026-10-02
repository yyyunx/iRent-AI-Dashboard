import type { AiViewerPose } from '../components/vehicle/Vehicle3DViewer';

export const GUIDANCE_INTERVAL_MS = 450;
export const GUIDANCE_MAX_FRAME_EDGE = 1280;
export const GUIDANCE_JPEG_QUALITY = 0.82;
export const GUIDANCE_MIN_INLIERS = 4;
export const GUIDANCE_MAX_REPROJECTION_ERROR_PX = 12;
export const GUIDANCE_EMA_ALPHA = 0.35;

export const canStartGuidanceRequest = (inFlight: boolean) => !inFlight;

export const isCurrentGuidanceResponse = (generation: number, currentGeneration: number, requestId: number, acceptedRequestId: number, aborted: boolean) =>
  generation === currentGeneration && requestId >= acceptedRequestId && !aborted;

type Vector3Tuple = [number, number, number];

const normalize = (values: Vector3Tuple): Vector3Tuple | null => {
  if (!values.every(Number.isFinite)) return null;
  const length = Math.hypot(...values);
  return length > 1e-8 ? values.map(value => value / length) as Vector3Tuple : null;
};

export const isReliableGuidance = (guidance: { success: boolean; inlier_count: number; reprojection_error: number | null; viewer_pose?: AiViewerPose }) =>
  guidance.success
  && guidance.inlier_count >= GUIDANCE_MIN_INLIERS
  && guidance.reprojection_error !== null
  && Number.isFinite(guidance.reprojection_error)
  && guidance.reprojection_error <= GUIDANCE_MAX_REPROJECTION_ERROR_PX
  && Boolean(guidance.viewer_pose);

export const smoothViewerPose = (previous: AiViewerPose | undefined, next: AiViewerPose): AiViewerPose | null => {
  const nextDirection = normalize(next.camera_direction_from_target);
  const nextUp = normalize(next.camera_up);
  if (!nextDirection || !nextUp) return null;
  if (!previous) return { camera_direction_from_target: nextDirection, camera_up: nextUp };
  const blend = (from: Vector3Tuple, to: Vector3Tuple): Vector3Tuple => from.map((value, index) => value + GUIDANCE_EMA_ALPHA * (to[index] - value)) as Vector3Tuple;
  const direction = normalize(blend(previous.camera_direction_from_target, nextDirection));
  const upCandidate = normalize(blend(previous.camera_up, nextUp));
  if (!direction || !upCandidate) return null;
  const projection = direction[0] * upCandidate[0] + direction[1] * upCandidate[1] + direction[2] * upCandidate[2];
  const up = normalize(upCandidate.map((value, index) => value - projection * direction[index]) as Vector3Tuple);
  return up ? { camera_direction_from_target: direction, camera_up: up } : null;
};
