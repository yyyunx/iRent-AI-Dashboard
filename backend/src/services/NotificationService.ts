import crypto from 'crypto';
import { DatabaseRepository } from '../repositories/DatabaseRepository';

type QueuedLineNotification = {
  id: number;
  incidentId: string | null;
  eventType: string;
  targetId: string;
  message: string;
  messages?: any[];
  retryKey?: string;
  queuedAt?: number;
};

/**
 * LINE delivery is deliberately decoupled from the incident request. A slow external
 * API must never delay dispatching or closing an incident in the operations dashboard.
 */
export class NotificationService {
  private readonly queue: QueuedLineNotification[] = [];
  private activeWorkers = 0;
  private readonly maxWorkers = 2;
  private escalationTimer?: NodeJS.Timeout;

  constructor(private readonly repo: DatabaseRepository) {
    const configured = Number(process.env.LINE_SENDING_STALE_SECONDS || 300);
    this.repo.recoverStaleLineNotifications(Number.isFinite(configured) ? configured : 300);
    for (const row of this.repo.getPendingNotifications()) {
      if (row.target_id) {
        this.queue.push({ id: row.id, incidentId: row.incident_id, eventType: row.event_type, targetId: row.target_id, message: row.message,
          messages: row.payload_json ? JSON.parse(row.payload_json) : undefined, retryKey: row.retry_key || undefined, queuedAt: Date.parse(row.created_at) });
      }
    }
    this.drain();
  }

  public getConfig() {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
    const configuredTarget = process.env.LINE_TARGET_ID || this.repo.getSetting('lineTargetId');
    const enabled = this.repo.getSetting('lineNotificationEnabled', 'true') === 'true';
    return {
      enabled,
      groupName: this.repo.getSetting('lineGroup', 'iRent Ops Alerts'),
      targetId: configuredTarget,
      targetConfigured: Boolean(configuredTarget),
      tokenConfigured: Boolean(accessToken),
      connected: enabled && Boolean(accessToken) && Boolean(configuredTarget),
      webhookConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
      dashboardUrl: this.dashboardUrl()?.origin || '',
      dashboardConfigured: Boolean(this.dashboardUrl()),
      targetSource: process.env.LINE_TARGET_ID ? 'environment' : 'dashboard'
    };
  }

  public updateSettings(input: { targetId?: string; groupName?: string; enabled?: boolean }) {
    if (input.targetId !== undefined) this.repo.setSetting('lineTargetId', input.targetId.trim());
    if (input.groupName !== undefined) this.repo.setSetting('lineGroup', input.groupName.trim() || 'iRent Ops Alerts');
    if (input.enabled !== undefined) this.repo.setSetting('lineNotificationEnabled', String(input.enabled));
  }

  public queueLineMessage(incidentId: string | null, eventType: string, message: string) {
    // A client retry must never fan out the same incident event to the ops group.
    // Failed rows remain retryable; queued/sending/sent are already represented by one delivery.
    if (incidentId && ['ai_detected', 'photo_submission', 'assignment_escalation'].includes(eventType)
      && this.repo.hasSuccessfulNotification(incidentId, eventType)) return 'deduplicated';
    const config = this.getConfig();
    if (!config.enabled || !config.targetId || !config.tokenConfigured) {
      const reason = !config.enabled ? 'LINE notifications are disabled' : !config.tokenConfigured
        ? 'LINE_CHANNEL_ACCESS_TOKEN is not configured' : 'LINE target ID is not configured';
      this.repo.addNotification({ provider: 'line', incidentId, eventType, targetId: config.targetId || null, message, status: 'not_configured', error: reason });
      return 'not_configured';
    }

    const messages = this.buildLineMessages({ incidentId, message });
    const retryKey = crypto.randomUUID();
    const id = this.repo.addNotification({ provider: 'line', incidentId, eventType, targetId: config.targetId, message, status: 'queued', payloadJson: JSON.stringify(messages), retryKey });
    this.queue.push({ id, incidentId, eventType, targetId: config.targetId, message, messages, retryKey, queuedAt: Date.now() });
    this.drain();
    return 'queued';
  }

  public verifyWebhookSignature(rawBody: Buffer, signature: string | undefined) {
    const secret = process.env.LINE_CHANNEL_SECRET;
    if (!secret) return { valid: false, reason: 'LINE_CHANNEL_SECRET is not configured' };
    if (!signature) return { valid: false, reason: 'Missing x-line-signature' };
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
    const received = Buffer.from(signature, 'base64');
    const valid = received.length === expected.length && crypto.timingSafeEqual(received, expected);
    return { valid, reason: valid ? '' : 'Invalid LINE webhook signature' };
  }

  public captureWebhookTargets(body: any) {
    let captured = 0;
    for (const event of Array.isArray(body?.events) ? body.events : []) {
      const source = event?.source || {};
      let targetId: string | undefined;
      if (source.type === 'group' && typeof source.groupId === 'string') {
        targetId = source.groupId;
        if (process.env.NODE_ENV !== 'production') console.info(`[LINE] groupId: ${source.groupId}`);
      } else if (source.type === 'room' && typeof source.roomId === 'string') {
        targetId = source.roomId;
      } else if (source.type === 'user' && typeof source.userId === 'string') {
        targetId = source.userId;
      }
      if (!targetId) continue;
      captured++;
      this.repo.setSetting('lineLastWebhookTargetId', targetId);
      this.repo.setSetting('lineLastWebhookSourceType', source.type);
      if (!process.env.LINE_TARGET_ID && !this.repo.getSetting('lineTargetId')) {
        this.repo.setSetting('lineTargetId', targetId);
      }
    }
    return captured;
  }

  private drain() {
    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      this.activeWorkers++;
      void this.deliver(item).finally(() => {
        this.activeWorkers--;
        this.drain();
      });
    }
  }

  public startEscalationWorker() {
    if (this.escalationTimer) return;
    this.escalationTimer = setInterval(() => {
      if (!this.repo.isOpen()) return this.close();
      this.scanAssignmentEscalations();
    }, 30_000);
    this.escalationTimer.unref();
  }

  public close() { if (this.escalationTimer) clearInterval(this.escalationTimer); this.escalationTimer = undefined; }

  public scanAssignmentEscalations() {
    if (!this.getConfig().connected) return 0;
    const configured = Number(process.env.LINE_ESCALATION_MINUTES || 10);
    const ageMinutes = Number.isFinite(configured) && configured > 0 ? configured : 10;
    let queued = 0;
    for (const incident of this.repo.getUnassignedUrgentIncidents(ageMinutes)) {
      if (!this.repo.claimAssignmentEscalation(incident.id)) continue;
      const message = `🚨 Incident ${incident.id} 尚未有人接單\n車輛：${incident.plate}\n緊急程度：${incident.urgency_score ?? 8}/10\n已超過 ${ageMinutes} 分鐘待派工，請立即確認。`;
      this.queueLineMessage(incident.id, 'assignment_escalation', message);
      this.repo.addTimeline(incident.id, 'assignment_escalation', 'Unassigned Incident Escalated', message);
      queued++;
    }
    return queued;
  }

  private dashboardUrl(): URL | null {
    try {
      const url = new URL(process.env.PUBLIC_DASHBOARD_URL || '');
      return url.protocol === 'https:' && !url.username && !url.password ? url : null;
    } catch { return null; }
  }

  /** URI buttons keep identity/authorization in our session + CSRF protected dashboard. */
  public buildLineMessages(item: { incidentId: string | null; message: string }) {
    const messages: any[] = [{ type: 'text', text: item.message.slice(0, 5000) }];
    const base = this.dashboardUrl();
    if (!item.incidentId || !base) return messages;
    const link = (intent?: string) => {
      const url = new URL('/operator/dashboard', base);
      url.searchParams.set('incidentId', item.incidentId!);
      if (intent) url.searchParams.set('intent', intent);
      return url.toString();
    };
    const incident = this.repo.getIncidentById(item.incidentId);
    if (!incident) return messages;
    const submission = incident.source_submission_id ? this.repo.getPhotoSubmissionDetail(incident.source_submission_id) : null;
    const urgency = incident.urgency_score ?? (incident.severity === 'high' ? 8 : incident.severity === 'medium' ? 5 : 1);
    const color = ['#16803A', '#42851D', '#698900', '#8B8A00', '#AD8500', '#CE7700', '#E76200', '#EE4400', '#E82912', '#DC2626'][Math.min(9, Math.max(0, urgency - 1))];
    const statuses: Record<string, string> = { todo: '🟡 待派工', assigned: `🔵 ${incident.assignee} 已接單`, in_progress: '🟠 處理中', waiting_review: '🟠 待人工覆核', resolved: '✅ 已完成', done: '✅ 已完成' };
    const actions = [{ type: 'uri', label: '查看案件', uri: link() }];
    if (['todo', 'assigned'].includes(incident.status)) actions.push(
      { type: 'uri', label: '指派給自己', uri: link('assign_self') },
      { type: 'uri', label: '指定人員派工', uri: link('assign') }
    );
    if (incident.status === 'assigned') actions.push({ type: 'uri', label: '開始處理', uri: link('start') });
    let abnormalPhotos = 0;
    if (submission) {
      abnormalPhotos = this.repo.getUploadedPhotosBySubmission(submission.submission_id).filter(photo => photo.damage_detected === 1 || photo.dirty_detected === 1).length;
    }
    const text = (value: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text: value.slice(0, 2000) || '-', wrap: true, size: 'sm', ...extra });
    let reasons: Array<{ type: string; count: number; subtotal: number }> = [];
    try { reasons = JSON.parse(incident.urgency_breakdown_json || '[]'); } catch { /* legacy */ }
    return [{
      type: 'flex', altText: `${urgency >= 8 ? '⚠️ High Priority · ' : ''}${incident.plate} · ${statuses[incident.status] || incident.status} · 緊急 ${urgency}/10`.slice(0, 1500),
      contents: {
        type: 'bubble', header: { type: 'box', layout: 'vertical', backgroundColor: color, contents: [text(`${urgency >= 8 ? '⚠️ High Priority · ' : ''}緊急 ${urgency}/10`, { color: '#FFFFFF', weight: 'bold' })] },
        body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          text(incident.plate, { size: 'xl', weight: 'bold' }), text(incident.id), text(statuses[incident.status] || incident.status, { weight: 'bold' }),
          text(incident.label), text(`異常 ${incident.issue_count || 0} 項 · 異常照片 ${abnormalPhotos} 張`),
          text(reasons.map(item => `${item.type} ×${item.count} (+${item.subtotal})`).join(' · ') || '既有案件依嚴重度換算'),
          text(`站點：${incident.station}`), text(`負責人：${incident.assignee}`),
          text(`提交：${submission?.phase === 'return' ? '還車' : submission?.phase === 'pickup' ? '取車' : '-'} · ${submission?.created_at || incident.created_at}`),
          text(item.message)
        ] },
        footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: actions.map(action => ({ type: 'button', height: 'sm', action })) }
      }
    }];
  }

  private async deliver(item: QueuedLineNotification) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      this.repo.updateNotification(item.id, 'not_configured', 0, 'LINE_CHANNEL_ACCESS_TOKEN is not configured');
      return;
    }

    let lastError = '';
    item.messages ||= this.buildLineMessages(item);
    item.retryKey ||= crypto.randomUUID();
    this.repo.saveNotificationPayload(item.id, JSON.stringify(item.messages), item.retryKey);
    const traceId = item.incidentId ? this.repo.getIncidentById(item.incidentId)?.source_submission_id || item.incidentId : null;
    const queuedAt = Number.isFinite(item.queuedAt) ? item.queuedAt! : Date.now();
    this.repo.recordStageMetric('line_queue_wait', traceId, queuedAt, Date.now() - queuedAt);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const attemptStartedAt = Date.now();
      const attemptStarted = process.hrtime.bigint();
      this.repo.updateNotification(item.id, 'sending', attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Line-Retry-Key': item.retryKey },
          body: JSON.stringify({ to: item.targetId, messages: item.messages }),
          signal: controller.signal
        });
        const responseText = await response.text();
        if (response.ok || (response.status === 409 && response.headers?.get('x-line-accepted-request-id'))) {
          this.repo.recordStageMetric('line_api', traceId, attemptStartedAt, Number(process.hrtime.bigint() - attemptStarted) / 1e6);
          this.repo.updateNotification(item.id, 'sent', attempt);
          if (traceId && item.eventType === 'ai_detected') {
            const start = this.repo.getMetricStart('submission_processing', traceId);
            if (start !== null) this.repo.recordStageMetric('submission_to_line_accepted', traceId, start, Date.now() - start);
          }
          if (item.incidentId) this.repo.addTimeline(item.incidentId, 'line_sent', 'LINE Sent', item.message);
          return;
        }
        lastError = `LINE API HTTP ${response.status}: ${responseText.slice(0, 300)}`;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          this.repo.recordStageMetric('line_api', traceId, attemptStartedAt, Number(process.hrtime.bigint() - attemptStarted) / 1e6, 'error');
          this.repo.updateNotification(item.id, 'failed', attempt, lastError);
          if (item.incidentId) this.repo.addTimeline(item.incidentId, 'line_failed', 'LINE Failed', lastError);
          return;
        }
      } catch (error: any) {
        lastError = error?.name === 'AbortError' ? 'LINE API timeout after 4 seconds' : (error?.message || String(error));
      } finally {
        clearTimeout(timer);
      }
      this.repo.recordStageMetric('line_api', traceId, attemptStartedAt, Number(process.hrtime.bigint() - attemptStarted) / 1e6, 'error');
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
    }
    this.repo.updateNotification(item.id, 'failed', 2, lastError);
    if (item.incidentId) this.repo.addTimeline(item.incidentId, 'line_failed', 'LINE Failed', lastError);
  }
}
