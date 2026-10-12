import crypto from 'crypto';
import { DatabaseRepository } from '../repositories/DatabaseRepository';

type QueuedLineNotification = {
  id: number;
  incidentId: string | null;
  eventType: string;
  targetId: string;
  message: string;
  imageUrls?: string[];
};

/**
 * LINE delivery is deliberately decoupled from the incident request. A slow external
 * API must never delay dispatching or closing an incident in the operations dashboard.
 */
export class NotificationService {
  private readonly queue: QueuedLineNotification[] = [];
  private activeWorkers = 0;
  private readonly maxWorkers = 2;

  constructor(private readonly repo: DatabaseRepository) {
    const configured = Number(process.env.LINE_SENDING_STALE_SECONDS || 300);
    this.repo.recoverStaleLineNotifications(Number.isFinite(configured) ? configured : 300);
    for (const row of this.repo.getPendingNotifications()) {
      if (row.target_id) {
        this.queue.push({ id: row.id, incidentId: row.incident_id, eventType: row.event_type, targetId: row.target_id, message: row.message });
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
      targetSource: process.env.LINE_TARGET_ID ? 'environment' : 'dashboard'
    };
  }

  public updateSettings(input: { targetId?: string; groupName?: string; enabled?: boolean }) {
    if (input.targetId !== undefined) this.repo.setSetting('lineTargetId', input.targetId.trim());
    if (input.groupName !== undefined) this.repo.setSetting('lineGroup', input.groupName.trim() || 'iRent Ops Alerts');
    if (input.enabled !== undefined) this.repo.setSetting('lineNotificationEnabled', String(input.enabled));
  }

  public queueLineMessage(incidentId: string | null, eventType: string, message: string, imageUrls: string[] = []) {
    // A client retry must never fan out the same incident event to the ops group.
    // Failed rows remain retryable; queued/sending/sent are already represented by one delivery.
    if (incidentId && this.repo.hasSuccessfulNotification(incidentId, eventType)) return 'deduplicated';
    const config = this.getConfig();
    if (!config.enabled || !config.targetId || !config.tokenConfigured) {
      const reason = !config.enabled ? 'LINE notifications are disabled' : !config.tokenConfigured
        ? 'LINE_CHANNEL_ACCESS_TOKEN is not configured' : 'LINE target ID is not configured';
      this.repo.addNotification({ provider: 'line', incidentId, eventType, targetId: config.targetId || null, message, status: 'not_configured', error: reason });
      return 'not_configured';
    }

    const id = this.repo.addNotification({ provider: 'line', incidentId, eventType, targetId: config.targetId, message, status: 'queued' });
    this.queue.push({ id, incidentId, eventType, targetId: config.targetId, message, imageUrls: imageUrls.filter(url => /^https:\/\//i.test(url)).slice(0, 4) });
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

  private async deliver(item: QueuedLineNotification) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      this.repo.updateNotification(item.id, 'not_configured', 0, 'LINE_CHANNEL_ACCESS_TOKEN is not configured');
      return;
    }

    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.repo.updateNotification(item.id, 'sending', attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            to: item.targetId,
            messages: [
              { type: 'text', text: item.message.slice(0, 5000) },
              ...(item.imageUrls || []).map(url => ({ type: 'image', originalContentUrl: url, previewImageUrl: url }))
            ].slice(0, 5)
          }),
          signal: controller.signal
        });
        const responseText = await response.text();
        if (response.ok) {
          this.repo.updateNotification(item.id, 'sent', attempt);
          if (item.incidentId) this.repo.addTimeline(item.incidentId, 'line_sent', 'LINE Sent', item.message);
          return;
        }
        lastError = `LINE API HTTP ${response.status}: ${responseText.slice(0, 300)}`;
      } catch (error: any) {
        lastError = error?.name === 'AbortError' ? 'LINE API timeout after 4 seconds' : (error?.message || String(error));
      } finally {
        clearTimeout(timer);
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
    }
    this.repo.updateNotification(item.id, 'failed', 2, lastError);
    if (item.incidentId) this.repo.addTimeline(item.incidentId, 'line_failed', 'LINE Failed', lastError);
  }
}
