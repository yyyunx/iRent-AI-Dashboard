export interface Incident {
  id: string;
  plate: string;
  station: string;
  type: string; // 'damage' | 'cleaning' | 'normal'
  label: string;
  severity: string; // 'high' | 'medium' | 'low'
  confidence: number;
  detected_time: string;
  next_booking: number;
  hot_station: number; // 0 or 1
  map_x: number;
  map_y: number;
  assignee: string;
  status: string;
  score: number;
  region: string;
  assigned_team: string;
  assigned_user_id?: number | null;
  issue_count?: number;
  urgency_score?: number | null;
  auto_closed: number; // 0 or 1
  ai_review_confidence?: number | null;
  ai_review_result?: string | null;
  ai_review_summary?: string | null;
  manual_review_required: number; // 0 or 1
  resolved_at?: string | null;
  owner_user_id?: number | null;
  source_submission_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  address?: string | null;
  parking_facility?: string | null;
  floor?: string | null;
  zone?: string | null;
  pillar?: string | null;
  parking_slot?: string | null;
  location_note?: string | null;
  operational_urgency?: string | null;
  sla_minutes?: number | null;
  vehicle_unavailable?: number | null;
  created_at: string;
  updated_at: string;
}

export type IncidentMapRow = Pick<Incident,
  'id' | 'plate' | 'latitude' | 'longitude' | 'severity' | 'address' |
  'parking_facility' | 'floor' | 'zone' | 'pillar' | 'parking_slot' |
  'location_note' | 'label' | 'type' | 'created_at'
>;

export interface IncidentResponse {
  id: string;
  plate: string;
  station: string;
  type: string;
  label: string;
  severity: string;
  confidence: number;
  time: string; // maps to detected_time
  nextBooking: number; // maps to next_booking
  hotStation: boolean; // maps to hot_station
  x: number; // maps to map_x
  y: number; // maps to map_y
  assignee: string;
  status: string;
  score: number;
  region: string;
  assignedTeam: string; // maps to assigned_team
  assignedUserId: number | null;
  sourceSubmissionId: string | null;
  issueCount: number;
  urgencyScore: number;
  autoClosed: boolean; // maps to auto_closed
  aiReviewConfidence: number | null;
  aiReviewResult: string | null;
  aiReviewSummary: string | null;
  manualReviewRequired: boolean; // maps to manual_review_required
  resolvedAt: string | null; // maps to resolved_at
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  address: string;
  parkingFacility: string;
  floor: string;
  zone: string;
  pillar: string;
  parkingSlot: string;
  locationNote: string;
  operationalUrgency: string | null;
  slaMinutes: number | null;
  vehicleUnavailable: boolean;
}

export interface IncidentTimeline {
  id?: number;
  incident_id: string;
  event_type: string;
  title: string;
  body?: string | null;
  created_at: string;
}

export interface DispatchTask {
  id?: number;
  incident_id: string;
  task_type: string;
  assignee: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id?: number;
  incident_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface NotificationLog {
  id?: number;
  provider: 'line';
  incident_id?: string | null;
  event_type: string;
  target_id?: string | null;
  message: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'not_configured';
  attempts: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  key: string;
  value: string;
  updated_at: string;
}

export interface MaintenanceReport {
  id?: number;
  incident_id: string;
  photo_path?: string | null;
  result: string;
  note?: string | null;
  ai_review_result?: string | null;
  ai_review_confidence?: number | null;
  ai_review_summary?: string | null;
  created_at: string;
}

export interface PhotoSubmission {
  id?: number;
  submission_id: string;
  rental_id: string;
  plate: string;
  phase: string;
  station?: string | null;
  parking_location?: string | null;
  status: string;
  overall_status: string;
  ai_summary?: string | null;
  coverage_summary_json?: string | null;
  damage_summary_json?: string | null;
  user_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  gps_captured_at?: string | null;
  address?: string | null;
  parking_facility?: string | null;
  floor?: string | null;
  zone?: string | null;
  pillar?: string | null;
  parking_slot?: string | null;
  location_note?: string | null;
  created_at: string;
}

export interface PhotoSubmissionResponse {
  submissionId: string;
  rentalId: string;
  plate: string;
  phase: string;
  station: string;
  parkingLocation: string;
  status: string;
  overallStatus: string;
  aiSummary: string | null;
  coverageSummary: any;
  damageSummary: any;
  createdAt: string;
  returnLocation: {
    latitude: number | null; longitude: number | null; gpsAccuracy: number | null; gpsCapturedAt: string | null;
    address: string; station: string; parkingFacility: string; floor: string; zone: string; pillar: string; parkingSlot: string; locationNote: string;
  };
}

export interface UploadedPhoto {
  id?: number;
  photo_id: string;
  submission_id?: string | null;
  rental_id: string;
  plate: string;
  phase: string;
  slot: string;
  filename: string;
  file_path?: string | null;
  quality_passed: number; // 0 or 1
  blur_score?: number | null;
  blur_threshold?: number | null;
  blur_checked_at?: string | null;
  is_blur: number; // 0 or 1
  plate_visible: number; // 0 or 1
  angle_valid: number; // 0 or 1
  distance_valid: number; // 0 or 1
  ai_result_json?: string | null;
  orientation_angle?: number | null;
  orientation_label?: string | null;
  orientation_confidence?: number | null;
  orientation_passed?: number | null;
  orientation_checked_at?: string | null;
  damage_detected?: number | null;
  damage_type?: string | null;
  damage_confidence?: number | null;
  dirty_detected?: number | null;
  dirty_confidence?: number | null;
  condition_checked_at?: string | null;
  user_id?: number | null;
  created_at: string;
}

export interface UploadedPhotoResponse {
  photoId: string;
  submissionId: string | null;
  rentalId: string;
  plate: string;
  phase: string;
  slot: string;
  filename: string;
  filePath: string | null;
  qualityPassed: boolean;
  blurScore: number | null;
  blurThreshold: number | null;
  blurCheckedAt: string | null;
  isBlur: boolean;
  plateVisible: boolean;
  angleValid: boolean;
  distanceValid: boolean;
  aiResult: any;
  orientation: { angle: number | null; label: string | null; confidence: number | null; passed: boolean | null; checkedAt: string | null; };
  condition: { damageDetected: boolean | null; damageType: string | null; damageConfidence: number | null; dirtyDetected: boolean | null; dirtyConfidence: number | null; checkedAt: string | null; };
  createdAt: string;
}

export type UserRole = 'user' | 'admin';

export interface UserAccount {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface SafeUser {
  id: number;
  username: string;
  role: UserRole;
}

export interface AuthSessionRecord {
  id: number;
  user_id: number;
  token_hash: string;
  csrf_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string;
  username: string;
  role: UserRole;
  is_active: number;
}

// Helpers for data mapping
export function dbRowToIncidentResponse(row: any): IncidentResponse {
  return {
    id: row.id,
    plate: row.plate,
    station: row.station,
    type: row.type,
    label: row.label,
    severity: row.severity,
    confidence: row.confidence,
    time: row.detected_time,
    nextBooking: row.next_booking,
    hotStation: Boolean(row.hot_station),
    x: row.map_x,
    y: row.map_y,
    assignee: row.assignee,
    status: row.status,
    score: row.score,
    region: row.region || '',
    assignedTeam: row.assigned_team || '',
    assignedUserId: row.assigned_user_id ?? null,
    sourceSubmissionId: row.source_submission_id ?? null,
    issueCount: row.issue_count ?? 0,
    urgencyScore: row.urgency_score ?? (row.severity === 'high' ? 8 : row.severity === 'medium' ? 5 : 1),
    autoClosed: Boolean(row.auto_closed),
    aiReviewConfidence: row.ai_review_confidence ?? null,
    aiReviewResult: row.ai_review_result ?? null,
    aiReviewSummary: row.ai_review_summary ?? null,
    manualReviewRequired: Boolean(row.manual_review_required),
    resolvedAt: row.resolved_at ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    gpsAccuracy: row.gps_accuracy ?? null,
    address: row.address || '',
    parkingFacility: row.parking_facility || '',
    floor: row.floor || '',
    zone: row.zone || '',
    pillar: row.pillar || '',
    parkingSlot: row.parking_slot || '',
    locationNote: row.location_note || '',
    operationalUrgency: row.operational_urgency ?? null,
    slaMinutes: row.sla_minutes ?? null,
    vehicleUnavailable: Boolean(row.vehicle_unavailable),
  };
}

export function dbRowToSubmissionResponse(row: any): PhotoSubmissionResponse {
  let coverageSummary = null;
  try { coverageSummary = row.coverage_summary_json ? JSON.parse(row.coverage_summary_json) : null; } catch { coverageSummary = null; }
  let damageSummary = null;
  try { damageSummary = row.damage_summary_json ? JSON.parse(row.damage_summary_json) : null; } catch { damageSummary = null; }
  return {
    submissionId: row.submission_id,
    rentalId: row.rental_id,
    plate: row.plate,
    phase: row.phase,
    station: row.station || '',
    parkingLocation: row.parking_location || '',
    status: row.status,
    overallStatus: row.overall_status,
    aiSummary: row.ai_summary ?? null,
    coverageSummary,
    damageSummary,
    createdAt: row.created_at,
    returnLocation: {
      latitude: row.latitude ?? null, longitude: row.longitude ?? null, gpsAccuracy: row.gps_accuracy ?? null, gpsCapturedAt: row.gps_captured_at ?? null,
      address: row.address || '', station: row.station || '', parkingFacility: row.parking_facility || '', floor: row.floor || '', zone: row.zone || '', pillar: row.pillar || '', parkingSlot: row.parking_slot || '', locationNote: row.location_note || ''
    },
  };
}

export function dbRowToPhotoResponse(row: any): UploadedPhotoResponse {
  let aiResult = {};
  if (row.ai_result_json) {
    try {
      aiResult = JSON.parse(row.ai_result_json);
    } catch (e) {
      aiResult = {};
    }
  }
  return {
    photoId: row.photo_id,
    submissionId: row.submission_id ?? null,
    rentalId: row.rental_id,
    plate: row.plate,
    phase: row.phase,
    slot: row.slot,
    filename: row.filename,
    filePath: row.file_path ?? null,
    qualityPassed: Boolean(row.quality_passed),
    blurScore: row.blur_score ?? null,
    blurThreshold: row.blur_threshold ?? null,
    blurCheckedAt: row.blur_checked_at ?? null,
    isBlur: Boolean(row.is_blur),
    plateVisible: Boolean(row.plate_visible),
    angleValid: Boolean(row.angle_valid),
    distanceValid: Boolean(row.distance_valid),
    aiResult,
    orientation: { angle: row.orientation_angle ?? null, label: row.orientation_label ?? null, confidence: row.orientation_confidence ?? null, passed: row.orientation_passed === null || row.orientation_passed === undefined ? null : Boolean(row.orientation_passed), checkedAt: row.orientation_checked_at ?? null },
    condition: { damageDetected: row.damage_detected === null || row.damage_detected === undefined ? null : Boolean(row.damage_detected), damageType: row.damage_type ?? null, damageConfidence: row.damage_confidence ?? null, dirtyDetected: row.dirty_detected === null || row.dirty_detected === undefined ? null : Boolean(row.dirty_detected), dirtyConfidence: row.dirty_confidence ?? null, checkedAt: row.condition_checked_at ?? null },
    createdAt: row.created_at,
  };
}
