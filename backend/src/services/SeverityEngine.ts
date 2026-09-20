import { VehicleConditionAnalysis } from './InspectionModels';

export type IncidentSeverity = 'low' | 'high' | 'critical';

export interface SeverityDecision {
  severity: IncidentSeverity;
  operationalUrgency: 'normal' | 'elevated' | 'urgent';
  slaMinutes: number;
  vehicleUnavailable: boolean;
}

/** Centralized rules: damage severity and response urgency are intentionally separate. */
export function decideSeverity(condition: VehicleConditionAnalysis): SeverityDecision {
  const type = condition.damage.type || 'unknown';
  if (condition.damage.detected && ['crack', 'broken'].includes(type)) {
    return { severity: 'critical', operationalUrgency: 'urgent', slaMinutes: 5, vehicleUnavailable: true };
  }
  if (condition.damage.detected && (condition.damage.confidence >= 0.8 || type === 'dent')) {
    return { severity: 'high', operationalUrgency: 'urgent', slaMinutes: 15, vehicleUnavailable: false };
  }
  return { severity: 'low', operationalUrgency: 'elevated', slaMinutes: condition.dirty.detected ? 45 : 60, vehicleUnavailable: false };
}

export function dispatchTaskFor(condition: VehicleConditionAnalysis, severity: SeverityDecision): string {
  if (severity.severity === 'critical') return 'Maintenance + Operations';
  if (condition.damage.detected) return 'Maintenance';
  return 'Cleaning';
}
