export const URGENCY_WEIGHTS = { dirty: 1, scratch: 2, dent: 3, damage: 4, broken: 4 } as const;
export type UrgencyType = keyof typeof URGENCY_WEIGHTS;
export type UrgencyBreakdown = { type: UrgencyType; count: number; weight: number; subtotal: number };

/** Scoring consumes confirmed, persisted model types. Expand rules here when models expand. */
export function calculateUrgency(findings: Array<{ damageDetected?: boolean; cleanliness?: string; damageType?: string; damage?: { detections?: Array<{ label?: string }> } }>) {
  const counts = new Map<UrgencyType, number>();
  const add = (type: UrgencyType) => counts.set(type, (counts.get(type) || 0) + 1);
  const damageType = (label: string | undefined): UrgencyType => ({ scratched: 'scratch', scratch: 'scratch', dented: 'dent', dent: 'dent', broken: 'broken', damage: 'damage' } as Record<string, UrgencyType>)[String(label || '').toLowerCase()] || 'damage';
  for (const finding of findings) {
    if (finding.damageDetected) {
      const detections = finding.damage?.detections || [];
      if (detections.length) for (const detection of detections) add(damageType(detection.label));
      else add(damageType(finding.damageType));
    }
    if (finding.cleanliness === 'dirty') add('dirty');
  }
  const breakdown: UrgencyBreakdown[] = [...counts].map(([type, count]) => ({ type, count, weight: URGENCY_WEIGHTS[type], subtotal: count * URGENCY_WEIGHTS[type] }));
  const issueCount = breakdown.reduce((sum, item) => sum + item.count, 0);
  const totalScore = breakdown.reduce((sum, item) => sum + item.subtotal, 0);
  const urgencyScore = Math.min(10, Math.max(1, totalScore));
  const severity = urgencyScore >= 7 ? 'high' : urgencyScore >= 4 ? 'medium' : 'low';
  return { issueCount, urgencyScore, severity, totalScore, breakdown };
}

export const incidentUrgency = calculateUrgency;
