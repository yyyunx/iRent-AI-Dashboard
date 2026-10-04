export const INCIDENT_STATES = ['pending_assignment', 'assigned', 'in_progress', 'resolved', 'false_positive', 'reopened'] as const;
export type IncidentState = typeof INCIDENT_STATES[number];
export const ACTION_STATES: Record<string, readonly IncidentState[]> = {
  dispatch: ['pending_assignment', 'assigned', 'reopened'],
  assign_self: ['pending_assignment', 'assigned', 'reopened'],
  in_progress: ['assigned', 'in_progress'],
  maintenance_report: ['in_progress'],
  resolve: ['in_progress'],
  reopen: ['resolved', 'false_positive'],
  false_positive: ['pending_assignment', 'assigned', 'in_progress', 'reopened'],
  reject: ['pending_assignment', 'assigned', 'in_progress', 'reopened']
};
export class IncidentConflictError extends Error {
  public readonly status = 409;
  constructor() { super('Incident state changed; refresh the incident before retrying.'); }
}
