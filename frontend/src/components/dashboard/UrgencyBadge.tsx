import React from 'react';

export const urgencyColor = (score: number) => `hsl(${120 * (10 - Math.min(10, Math.max(1, score))) / 9} 75% 35%)`;

const UrgencyBadge: React.FC<{ score: number; issueCount?: number }> = ({ score, issueCount }) => (
  <span className="urgency-badge" style={{ borderColor: urgencyColor(score), color: urgencyColor(score) }} title={issueCount ? `偵測到 ${issueCount} 個異常項目；每項加 1，最高 10` : '既有案件依嚴重度換算'}>
    <span style={{ backgroundColor: urgencyColor(score) }} />緊急 {score}/10
  </span>
);

export default UrgencyBadge;
