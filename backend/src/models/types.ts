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
  auto_closed: number; // 0 or 1
  ai_review_confidence?: number | null;
  ai_review_result?: string | null;
  ai_review_summary?: string | null;
  manual_review_required: number; // 0 or 1
  resolved_at?: string | null;
  owner_user_id?: number | null;
  source_submission_id?: string | null;
  created_at: string;
  updated_at: string;
}

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
  autoClosed: boolean; // maps to auto_closed
  aiReviewConfidence: number | null;
  aiReviewResult: string | null;
  aiReviewSummary: string | null;
  manualReviewRequired: boolean; // maps to manual_review_required
  resolvedAt: string | null; // maps to resolved_at
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
  user_id?: number | null;
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
  createdAt: string;
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
    autoClosed: Boolean(row.auto_closed),
    aiReviewConfidence: row.ai_review_confidence ?? null,
    aiReviewResult: row.ai_review_result ?? null,
    aiReviewSummary: row.ai_review_summary ?? null,
    manualReviewRequired: Boolean(row.manual_review_required),
    resolvedAt: row.resolved_at ?? null,
  };
}

export function dbRowToSubmissionResponse(row: any): PhotoSubmissionResponse {
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
    createdAt: row.created_at,
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
    createdAt: row.created_at,
  };
}
