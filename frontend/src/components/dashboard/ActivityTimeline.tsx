import React from 'react';
import { BellRing, Bot, CheckCircle2, Clock3, MessageCircle, Wrench } from 'lucide-react';
import { TimelineItem } from '../../context/AppContext';
import { formatTimelineEvent } from '../../utils/timelineAdapter';

interface ActivityTimelineProps {
  incidentId?: string;
  events: TimelineItem[];
}

const getIcon = (eventType: string) => {
  if (eventType.includes('line') || eventType.includes('slack')) return BellRing;
  if (eventType.includes('comment')) return MessageCircle;
  if (eventType.includes('closed') || eventType.includes('resolved') || eventType.includes('passed')) return CheckCircle2;
  if (eventType.includes('dispatch') || eventType.includes('assigned') || eventType.includes('progress')) return Wrench;
  return Bot;
};

const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ incidentId, events }) => (
  <section className="surface-card activity-card">
    <header><div><span className="eyebrow">AUDIT TRAIL</span><h2>最近活動紀錄</h2></div><span className="live-badge"><span />即時</span></header>
    <div className="activity-list">
      {events.length ? events.slice(-6).reverse().map(event => {
        const formatted = formatTimelineEvent(event, incidentId);
        const Icon = getIcon(event.event_type);
        return (
          <article key={formatted.id} className="activity-item">
            <time>{formatted.time}</time>
            <span className={`activity-dot ${formatted.isLineEvent ? 'activity-dot--line' : ''}`}><Icon size={13} /></span>
            <div><strong>{formatted.displayTitle}</strong><p>{formatted.displayBody}</p></div>
          </article>
        );
      }) : <div className="empty-state empty-state--compact"><Clock3 size={24} /><span>尚無活動紀錄</span></div>}
    </div>
  </section>
);

export default ActivityTimeline;
