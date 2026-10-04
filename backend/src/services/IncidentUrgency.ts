/** Count persisted model findings, not client claims or the number of uploaded photos. */
export function incidentUrgency(findings: Array<{ damageDetected?: boolean; cleanliness?: string; damage?: { detection_count?: number; detections?: unknown[] } }>) {
  const issueCount = findings.reduce((count, finding) => {
    const detections = finding.damage?.detections?.length || 0;
    return count + (finding.damageDetected ? Math.max(1, detections) : 0)
      + (finding.cleanliness === 'dirty' ? 1 : 0);
  }, 0);
  const urgencyScore = Math.min(10, Math.max(1, issueCount));
  const severity = urgencyScore >= 7 ? 'high' : urgencyScore >= 4 ? 'medium' : 'low';
  return { issueCount, urgencyScore, severity };
}
