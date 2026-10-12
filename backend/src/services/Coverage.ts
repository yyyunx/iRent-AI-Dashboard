export const VIEW_SECTORS = [
  'FRONT', 'FRONT_RIGHT', 'RIGHT', 'REAR_RIGHT',
  'REAR', 'REAR_LEFT', 'LEFT', 'FRONT_LEFT'
] as const;

export type ViewSector = typeof VIEW_SECTORS[number];
export type GuidanceStatus = 'FULL' | 'DEGRADED' | 'UNAVAILABLE';

export interface PersistedGuidance {
  guidance_status: GuidanceStatus;
  solver_used: 'EPNP' | 'AP3P' | 'NONE';
  view_sector: ViewSector | null;
  covered_sectors: ViewSector[];
  inlier_count?: number;
  inlier_ratio?: number;
  reprojection_error?: number | null;
  success?: boolean;
  failure_reason?: string | null;
  intrinsics?: { focal_length_px?: number; principal_point_px?: [number, number] } | null;
  pose_debug?: {
    rotation_camera_to_object?: number[][];
    camera_center_car_frame?: [number, number, number];
  } | null;
}

export interface CoverageSummary {
  covered_sectors: ViewSector[];
  coverage_percentage: number;
  missing_sectors: ViewSector[];
  next_view_recommendation: ViewSector | null;
}

export function normalizeGuidance(value: any): PersistedGuidance {
  const status: GuidanceStatus = ['FULL', 'DEGRADED', 'UNAVAILABLE'].includes(value?.guidance_status)
    ? value.guidance_status : 'UNAVAILABLE';
  const sector = VIEW_SECTORS.includes(value?.view_sector) ? value.view_sector as ViewSector : null;
  const covered = status === 'UNAVAILABLE' || !sector ? [] : [sector];
  return {
    guidance_status: status,
    solver_used: ['EPNP', 'AP3P', 'NONE'].includes(value?.solver_used) ? value.solver_used : 'NONE',
    view_sector: sector,
    covered_sectors: covered,
    inlier_count: Number.isFinite(value?.inlier_count) ? value.inlier_count : undefined,
    inlier_ratio: Number.isFinite(value?.inlier_ratio) ? value.inlier_ratio : undefined,
    reprojection_error: Number.isFinite(value?.reprojection_error) ? value.reprojection_error : null,
    success: value?.success === true,
    failure_reason: typeof value?.failure_reason === 'string' ? value.failure_reason : null,
    intrinsics: value?.intrinsics || null,
    pose_debug: value?.pose_debug || null,
  };
}

export function calculateCoverage(guidanceResults: Array<PersistedGuidance | null | undefined>): CoverageSummary {
  const coveredSet = new Set<ViewSector>();
  guidanceResults.forEach(item => item?.covered_sectors.forEach(sector => {
    if (VIEW_SECTORS.includes(sector)) coveredSet.add(sector);
  }));
  const covered = VIEW_SECTORS.filter(sector => coveredSet.has(sector));
  const missing = VIEW_SECTORS.filter(sector => !coveredSet.has(sector));
  return {
    covered_sectors: covered,
    coverage_percentage: (covered.length / VIEW_SECTORS.length) * 100,
    missing_sectors: missing,
    // Fixed clockwise order is deterministic and intentionally not path planning.
    next_view_recommendation: missing[0] || null,
  };
}
