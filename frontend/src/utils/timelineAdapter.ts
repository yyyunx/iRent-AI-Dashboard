import { TimelineItem } from '../context/AppContext';

/**
 * Normalizes legacy Slack wording to LINE for presentation layer without changing database or API contracts.
 */
export function normalizeTimelineText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/Slack Sent/gi, '已發送 LINE 通知')
    .replace(/Slack/gi, 'LINE');
}

export interface FormattedTimelineEvent {
  id: string | number;
  displayTitle: string;
  displayBody: string;
  time: string;
  isLineEvent: boolean;
  rawEvent: TimelineItem;
}

export function formatTimelineEvent(event: TimelineItem, incidentId?: string): FormattedTimelineEvent {
  const displayTitle = normalizeTimelineText(event.title);
  const displayBody = normalizeTimelineText(event.body || incidentId || '');
  const time = String(event.created_at || '').split(' ').pop()?.slice(0, 5) || '--:--';
  const isLineEvent = event.event_type.includes('line') || event.event_type.includes('slack');

  return {
    id: event.id,
    displayTitle,
    displayBody,
    time,
    isLineEvent,
    rawEvent: event
  };
}
