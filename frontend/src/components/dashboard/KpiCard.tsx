import React from 'react';
import { LucideIcon } from 'lucide-react';

type KpiTone = 'blue' | 'red' | 'amber' | 'green' | 'purple';
type TrendTone = 'positive' | 'warning' | 'neutral' | 'ai';

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint: string;
  trend?: string;
  trendTone?: TrendTone;
  tone: KpiTone;
}

const KpiCard: React.FC<KpiCardProps> = ({ icon: Icon, label, value, hint, trend, trendTone = 'neutral', tone }) => (
  <article className="kpi-card">
    <div className={`kpi-icon kpi-icon--${tone}`}><Icon size={21} strokeWidth={2.3} /></div>
    <div className="min-w-0">
      <span className="kpi-label">{label}</span>
      <div className="flex items-end gap-2 mt-1">
        <strong className={`kpi-value kpi-value--${tone}`}>{value}</strong>
        {trend && <span className={`kpi-trend kpi-trend--${trendTone}`}>{trend}</span>}
      </div>
      <small className="kpi-hint">{hint}</small>
    </div>
  </article>
);

export default KpiCard;
