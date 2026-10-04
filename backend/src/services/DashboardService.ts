import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { DatabaseRepository, DEFAULT_DAMAGE_HOTSPOTS } from '../repositories/DatabaseRepository';
import { NotificationService } from './NotificationService';
import { AiAgentService } from './AiAgentService';
import {
  Incident,
  IncidentResponse,
  SafeUser,
  dbRowToIncidentResponse,
  dbRowToSubmissionResponse,
  dbRowToPhotoResponse
} from '../models/types';
import { analyzeImageQuality, validateImageDataUrl } from './ImageValidation';
import { OPERATIONS_SOP } from '../knowledge/operationsSop';
import { analyzeCaptureGuidance, analyzeOrientation, analyzeVehicleCondition, isFeatureEnabled, PersistedDamageResult } from './InspectionModels';
import { validateReturnLocation } from './ReturnLocation';
import { calculateCoverage, normalizeGuidance, PersistedGuidance } from './Coverage';
import { incidentUrgency } from './IncidentUrgency';

export class DashboardService {
  private repo: DatabaseRepository;
  private uploadDir: string;
  private notifications: NotificationService;
  private aiAgent: AiAgentService;

  constructor(repo: DatabaseRepository, uploadDir: string) {
    this.repo = repo;
    this.uploadDir = uploadDir;
    this.notifications = new NotificationService(repo);
    const aiSecretFile = process.env.GEMINI_API_KEY_FILE || path.join(path.dirname(uploadDir), 'secrets', 'gemini-api-key');
    this.aiAgent = new AiAgentService(repo, aiSecretFile);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  }

  // --- Calculations & Helpers ---
  public calculateScore(item: Partial<Incident>): number {
    let score = 0;
    if (item.type === "damage") score += 60;
    if (item.type === "cleaning") score += 20;
    if (item.next_booking !== undefined && item.next_booking <= 30) score += 30;
    if (item.hot_station) score += 20;
    if (item.confidence !== undefined && item.confidence >= 90) score += 15;
    if (item.severity === "medium") score += 8;
    return Math.min(score, 100);
  }

  public getOpsMetrics(incidents = this.repo.getIncidents()) {
    const reportsCount = this.repo.getMaintenanceReportCount();
    const autoClosedCount = incidents.filter(i => i.auto_closed === 1).length;
    const waitingCount = incidents.filter(i => i.status === 'waiting_review').length;

    const rate = reportsCount > 0 ? Math.round((autoClosedCount / reportsCount) * 100) : 0;
    const savedMinutes = autoClosedCount * 18 + Math.max(waitingCount, 0) * 6;

    return {
      autoCloseRate: `${rate}%`,
      manualReviewReduced: autoClosedCount,
      avgTimeSaved: `${savedMinutes}分`
    };
  }

  public getProjectState(user: SafeUser) {
    const isAdmin = user.role === 'admin';
    const incidentsRaw = isAdmin ? this.repo.getIncidents() : this.repo.getIncidentsForUser(user.id);
    const incidents = incidentsRaw.map(row => {
      const enriched = { ...row, score: this.calculateScore(row) };
      return dbRowToIncidentResponse(enriched);
    });

    // Sort by priority score desc
    incidents.sort((a, b) => b.score - a.score);

    const allowedIncidentIds = new Set(incidents.map(item => item.id));
    const filterByIncident = <T>(records: Record<string, T[]>) => Object.fromEntries(Object.entries(records).filter(([id]) => allowedIncidentIds.has(id)));
    const timelines = filterByIncident(this.repo.getTimelines());
    const comments = isAdmin ? this.repo.getComments() : {};
    const notifications = isAdmin ? this.repo.getNotifications() : [];
    const reports = isAdmin ? this.repo.getMaintenanceReports() : {};
    const submissionsRaw = isAdmin ? this.repo.getPhotoSubmissions() : this.repo.getPhotoSubmissionsForUser(user.id);
    const submissions = submissionsRaw.map(row => dbRowToSubmissionResponse(row));
    const uploadedPhotosRaw = isAdmin ? this.repo.getUploadedPhotos() : this.repo.getUploadedPhotosForUser(user.id);
    const uploadedPhotos = uploadedPhotosRaw.map(row => dbRowToPhotoResponse(row));

    const lineConfig = isAdmin ? this.notifications.getConfig() : {
      enabled: false, groupName: '', targetId: '', targetConfigured: false, tokenConfigured: false,
      connected: false, webhookConfigured: false, targetSource: 'dashboard' as const
    };
    const lineGroup = lineConfig.groupName;
    const aiConfig = isAdmin ? this.aiAgent.getConfig() : { provider: 'google-gemini' as const, model: '', keyConfigured: false, keySource: 'dashboard' as const };

    const lineLogs = notifications.filter(row => row.provider === 'line').map(row => ({
      title: `${row.status} · ${row.event_type} · ${row.incident_id || '-'}`,
      time: row.created_at,
      group: lineGroup,
      message: row.message,
      status: row.status,
      error: row.error || null
    }));

    const hotspotsVal = JSON.parse(this.repo.getSetting('damageHotspots', JSON.stringify(DEFAULT_DAMAGE_HOTSPOTS)));

    return {
      incidents,
      damageHotspots: hotspotsVal,
      lineGroup,
      lineConfig,
      aiConfig,
      lineLogs,
      timelines,
      comments,
      notificationStats: isAdmin ? this.repo.getNotificationStats() : [],
      maintenanceReports: reports,
      photoSubmissions: submissions,
      uploadedPhotos,
      inspectionConfig: this.getInspectionConfig(),
      opsMetrics: isAdmin ? this.getOpsMetrics(incidentsRaw) : { autoCloseRate: '0%', manualReviewReduced: 0, avgTimeSaved: '0分' }
    };
  }

  public createOpaqueId(prefix: string): string {
    return `${prefix}-${randomBytes(12).toString('base64url')}`;
  }

  public updateLineSettings(input: { targetId?: string; groupName?: string; enabled?: boolean }) {
    this.notifications.updateSettings(input);
  }

  public updateAiSettings(input: { apiKey?: string; model?: string; clearApiKey?: boolean }) {
    this.aiAgent.updateSettings(input);
  }

  public getLineConfig() {
    return this.notifications.getConfig();
  }

  public getAiConfig() {
    return this.aiAgent.getConfig();
  }

  public getInspectionConfig() {
    return {
      orientationCheckEnabled: isFeatureEnabled('ORIENTATION_CHECK_ENABLED'),
      conditionCheckEnabled: isFeatureEnabled('CONDITION_CHECK_ENABLED')
    };
  }

  public getIncidentMapMarkers() {
    return this.repo.getIncidentMapRows().map(incident => ({
      incidentId: incident.id,
      carNumber: incident.plate,
      latitude: incident.latitude ?? null,
      longitude: incident.longitude ?? null,
      severity: incident.severity,
      address: incident.address || '',
      parkingFacility: incident.parking_facility || '',
      floor: incident.floor || '',
      zone: incident.zone || '',
      pillar: incident.pillar || '',
      parkingSlot: incident.parking_slot || '',
      locationNote: incident.location_note || '',
      incident: incident.label,
      type: incident.type,
      detectedAt: incident.created_at
    }));
  }

  private incidentAgeMinutes(incident: Incident): number {
    const raw = incident.created_at || incident.detected_time;
    const timestamp = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T')).getTime();
    return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 60_000)) : 0;
  }

  public getAgentOperations() {
    const rows = this.repo.getIncidents();
    const active = rows.filter(item => !['resolved', 'done'].includes(item.status));
    const notifications = this.repo.getNotificationStats();
    const lineWaiting = notifications
      .filter(item => item.provider === 'line' && ['queued', 'sending', 'failed'].includes(item.status))
      .reduce((sum, item) => sum + item.count, 0);

    const slaAlerts = active.map(item => {
      const ageMinutes = this.incidentAgeMinutes(item);
      const threshold = item.status === 'todo' ? 60 : item.status === 'assigned' ? 120 : 240;
      const bookingRisk = item.next_booking <= 30;
      const overdue = ageMinutes >= threshold;
      if (!overdue && !bookingRisk) return null;
      const urgency = item.next_booking <= 15 || ageMinutes >= threshold * 2 ? 'critical' : 'warning';
      return {
        incidentId: item.id,
        plate: item.plate,
        station: item.station,
        status: item.status,
        urgency,
        ageMinutes,
        thresholdMinutes: threshold,
        nextBookingMinutes: item.next_booking,
        reasons: [overdue ? `案件已停留 ${ageMinutes} 分鐘` : '', bookingRisk ? `${item.next_booking} 分鐘後有預約` : ''].filter(Boolean)
      };
    }).filter(Boolean).sort((left: any, right: any) => {
      if (left.urgency !== right.urgency) return left.urgency === 'critical' ? -1 : 1;
      return left.nextBookingMinutes - right.nextBookingMinutes || right.ageMinutes - left.ageMinutes;
    }).slice(0, 20);

    const dispatchDraft = active
      .filter(item => ['todo', 'waiting_review', 'assigned'].includes(item.status))
      .map(item => {
        const score = this.calculateScore(item);
        const [recommendedTeam, region] = this.repo.assignTeam(item.station);
        return {
          incidentId: item.id,
          plate: item.plate,
          station: item.station,
          label: item.label,
          severity: item.severity,
          score,
          nextBookingMinutes: item.next_booking,
          recommendedTeam,
          region,
          reason: `${item.severity === 'high' ? '高嚴重度；' : ''}${item.next_booking <= 30 ? `${item.next_booking} 分鐘後有預約；` : ''}Priority Score ${score}`
        };
      })
      .sort((left, right) => right.score - left.score || left.nextBookingMinutes - right.nextBookingMinutes)
      .slice(0, 8);

    const groupCounts = (keyOf: (item: Incident) => string, dimension: string) => {
      const groups = new Map<string, Incident[]>();
      for (const item of rows) {
        const key = keyOf(item);
        groups.set(key, [...(groups.get(key) || []), item]);
      }
      return [...groups.entries()].filter(([, items]) => items.length >= 2).map(([key, items]) => ({
        dimension,
        key,
        count: items.length,
        incidentIds: items.slice(0, 10).map(item => item.id),
        evidence: `${items.length} 件 Incident`
      }));
    };
    const clusters = [
      ...groupCounts(item => item.plate, 'vehicle'),
      ...groupCounts(item => `${item.station} / ${item.label}`, 'station_damage'),
      ...groupCounts(item => item.type, 'incident_type')
    ].sort((left, right) => right.count - left.count).slice(0, 10);

    return {
      generatedAt: new Date().toISOString(),
      shiftBriefing: {
        activeIncidents: active.length,
        highRiskIncidents: active.filter(item => item.severity === 'high').length,
        bookingRiskIncidents: active.filter(item => item.next_booking <= 30).length,
        overdueIncidents: slaAlerts.filter((item: any) => item.ageMinutes >= item.thresholdMinutes).length,
        pendingMaintenance: active.filter(item => ['assigned', 'in_progress', 'waiting_review'].includes(item.status)).length,
        lineNotificationsNeedingAttention: lineWaiting
      },
      slaAlerts,
      dispatchDraft,
      clusters
    };
  }

  public getAgentTaskHistory(limit = 20) {
    return this.repo.getAgentTaskHistory(limit).map(row => ({
      id: row.id,
      taskType: row.task_type,
      promptSummary: row.prompt_summary,
      resultSummary: row.result_summary,
      model: row.model,
      status: row.status,
      username: row.username || null,
      createdAt: row.created_at
    }));
  }

  private redactAgentHistoryText(value: string, maxLength: number) {
    return value
      .replace(/(password|session|csrf|token|secret|api[ _-]?key)\s*[:=]?\s*[^\s,;]+/gi, '$1=[REDACTED]')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  public recordAgentTask(userId: number, prompt: string, result: any, status: 'completed' | 'failed', taskType = 'operations_query') {
    const answer = result?.answer || result;
    const resultText = status === 'completed'
      ? [answer?.title, answer?.insight, answer?.recommendation].filter(Boolean).join(' — ')
      : String(result?.error || 'AI request failed');
    return this.repo.addAgentTaskHistory({
      userId,
      taskType,
      promptSummary: this.redactAgentHistoryText(prompt, 180),
      resultSummary: this.redactAgentHistoryText(resultText, 600),
      model: result?.model || this.aiAgent.getConfig().model,
      status
    });
  }

  public querySop(prompt: string) {
    const normalized = prompt.toLowerCase();
    const ranked = OPERATIONS_SOP.map(section => ({
      section,
      score: section.keywords.reduce((score, keyword) => score + (normalized.includes(keyword.toLowerCase()) ? 1 : 0), 0)
    })).sort((left, right) => right.score - left.score);
    const matches = ranked.filter(item => item.score > 0).slice(0, 3).map(item => item.section);
    const selected = matches.length ? matches : [OPERATIONS_SOP[0]];
    return {
      answer: {
        title: selected[0].title,
        insight: selected.map(item => item.content).join(' '),
        recommendation: '請依引用章節執行，涉及派工、通知、結案或求償時仍需管理員確認。',
        evidence: selected.map(item => `${item.source} § ${item.chapter}`).join('；')
      },
      model: 'bounded-sop-retrieval',
      sources: selected.map(item => ({ id: item.id, source: item.source, chapter: item.chapter, title: item.title }))
    };
  }

  public queryAuditLogs(prompt: string) {
    const normalized = prompt.toLowerCase();
    const action = /reopen|重開|重新開啟/.test(normalized) ? 'REOPEN_INCIDENT'
      : /line/.test(normalized) && /設定|config|修改/.test(normalized) ? 'LINE_CONFIG_CHANGE'
        : /降權|拒絕|forbidden|admin api|權限/.test(normalized) ? 'AUTHZ_DENIED' : null;
    const today = /今天|今日|today/.test(normalized);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const matches = this.repo.getRecentAuditLogs(200).filter(row => {
      if (action && row.action !== action) return false;
      if (today && Date.parse(row.timestamp) < todayStart.getTime()) return false;
      return true;
    }).slice(0, 50).map(row => ({
      id: row.id,
      username: row.username || 'system',
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      timestamp: row.timestamp
    }));
    return {
      answer: {
        title: action ? `Audit 查詢：${action}` : '最近 Audit Log',
        insight: matches.length ? `找到 ${matches.length} 筆符合條件的紀錄。` : '沒有找到符合條件的紀錄。',
        recommendation: '如需調查，請以回傳的事件 ID、操作者與時間進一步核對；查詢本身不會修改資料。',
        evidence: matches.slice(0, 8).map(row => `${row.timestamp} ${row.username} ${row.action} ${row.resourceId || ''}`.trim()).join('；') || '限定查詢最近 200 筆 AuditLog。'
      },
      model: 'allowlisted-audit-query',
      query: { action, today, scannedLimit: 200 },
      records: matches
    };
  }

  private localImageDataUrl(filePath: string) {
    const filename = path.basename(filePath);
    const resolved = path.resolve(this.uploadDir, filename);
    if (path.dirname(resolved) !== path.resolve(this.uploadDir)) throw new Error('Photo path is outside upload storage');
    const stats = fs.statSync(resolved);
    if (!stats.isFile() || stats.size <= 0 || stats.size > 10 * 1024 * 1024) throw new Error('Photo file is unavailable or too large');
    const extension = path.extname(filename).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : '';
    if (!mime) throw new Error('Photo file type is not supported');
    return `data:${mime};base64,${fs.readFileSync(resolved).toString('base64')}`;
  }

  public async compareIncidentPhotos(beforePhotoId: string, afterPhotoId: string) {
    if (!beforePhotoId || !afterPhotoId || beforePhotoId === afterPhotoId) {
      return { status: 400, ok: false, error: 'Two different photo IDs are required' };
    }
    const before = this.repo.getUploadedPhotoById(beforePhotoId);
    const after = this.repo.getUploadedPhotoById(afterPhotoId);
    if (!before?.file_path || !after?.file_path) return { status: 404, ok: false, error: 'Photo not found' };
    if (before.plate !== after.plate) return { status: 409, ok: false, error: 'Photos must belong to the same vehicle' };
    if (before.slot !== after.slot) return { status: 409, ok: false, error: 'Photos must use the same camera slot' };
    const result = await this.aiAgent.analyzeImages(
      `比較同一車輛 ${before.plate}、同一拍攝位置 ${before.slot} 的前後照片，區分舊傷、新傷、髒污與照片品質問題。低信心一律人工覆核。`,
      [
        { label: `較早照片 (${before.phase})`, dataUrl: this.localImageDataUrl(before.file_path) },
        { label: `較晚照片 (${after.phase})`, dataUrl: this.localImageDataUrl(after.file_path) }
      ]
    );
    return { ok: true, ...result, photoIds: [beforePhotoId, afterPhotoId] };
  }

  public createDispatchDraft(incidentId: string, userId: number) {
    const incident = this.repo.getIncidentById(incidentId);
    if (!incident) return { status: 404, ok: false, error: 'Incident not found' };
    if (!['todo', 'waiting_review', 'assigned'].includes(incident.status)) {
      return { status: 409, ok: false, error: 'Incident is no longer eligible for dispatch' };
    }
    const [recommendedTeam, region] = this.repo.assignTeam(incident.station);
    const draft = this.repo.createAgentActionDraft({
      id: this.createOpaqueId('DRAFT'),
      draftType: 'dispatch',
      incidentId,
      payload: { recommendedTeam, region, score: this.calculateScore(incident) },
      createdBy: userId,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    return {
      ok: true,
      draft: {
        id: draft.id,
        type: draft.draft_type,
        incidentId: draft.incident_id,
        preview: JSON.parse(draft.payload_json),
        status: draft.status,
        expiresAt: draft.expires_at
      }
    };
  }

  public createLineDraft(incidentId: string, style: string, userId: number) {
    const incident = this.repo.getIncidentById(incidentId);
    if (!incident) return { status: 404, ok: false, error: 'Incident not found' };
    const safeStyle = ['urgent', 'standard', 'completed'].includes(style) ? style : 'standard';
    const response = dbRowToIncidentResponse({ ...incident, score: this.calculateScore(incident) });
    const heading = safeStyle === 'urgent' ? '緊急營運通知' : safeStyle === 'completed' ? '維修完成通知' : '案件進度通知';
    const message = [
      `【${heading}】`,
      `案件：${response.id}`,
      `車輛：${response.plate}`,
      `站點：${response.station}`,
      `事件：${response.label}`,
      `狀態：${response.status}`,
      `下一筆預約：${response.nextBooking} 分鐘`
    ].join('\n').slice(0, 1000);
    const draft = this.repo.createAgentActionDraft({
      id: this.createOpaqueId('DRAFT'),
      draftType: 'line',
      incidentId,
      payload: { style: safeStyle, message },
      createdBy: userId,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    return {
      ok: true,
      draft: {
        id: draft.id,
        type: draft.draft_type,
        incidentId: draft.incident_id,
        preview: JSON.parse(draft.payload_json),
        status: draft.status,
        expiresAt: draft.expires_at
      }
    };
  }

  public async confirmAgentActionDraft(draftId: string) {
    const draft = this.repo.getAgentActionDraft(draftId);
    if (!draft) return { status: 404, ok: false, error: 'Draft not found' };
    if (draft.status !== 'pending') return { status: 409, ok: false, error: 'Draft has already been processed' };
    if (draft.expires_at <= new Date().toISOString()) {
      this.repo.finishAgentActionDraft(draftId, 'expired');
      return { status: 409, ok: false, error: 'Draft has expired' };
    }
    const incident = this.repo.getIncidentById(draft.incident_id);
    if (!incident) return { status: 404, ok: false, error: 'Incident not found' };
    if (draft.draft_type === 'dispatch' && !['todo', 'waiting_review', 'assigned'].includes(incident.status)) {
      return { status: 409, ok: false, error: 'Incident state changed; create a new draft' };
    }
    if (!this.repo.claimAgentActionDraft(draftId)) return { status: 409, ok: false, error: 'Draft has already been processed' };

    try {
      if (draft.draft_type === 'dispatch') {
        const result = await this.handleAction({ action: 'dispatch', incidentId: draft.incident_id });
        if (!result.ok) throw new Error(result.error || 'Dispatch failed');
        this.repo.finishAgentActionDraft(draftId, 'confirmed');
        return { ok: true, action: 'dispatch', incident: result.incident };
      }
      const payload = JSON.parse(draft.payload_json);
      const queueStatus = this.notifyLine(draft.incident_id, `agent_${payload.style}`, String(payload.message));
      this.repo.finishAgentActionDraft(draftId, 'confirmed');
      return { ok: true, action: 'line', queueStatus, incident: dbRowToIncidentResponse(incident) };
    } catch (error) {
      this.repo.finishAgentActionDraft(draftId, 'failed');
      throw error;
    }
  }

  public runAiAgent(prompt: string) {
    const incidents = this.repo.getIncidents().map(row => ({ response: dbRowToIncidentResponse({ ...row, score: this.calculateScore(row) }), createdAt: row.created_at }));
    const active = incidents.filter(item => !['resolved', 'done'].includes(item.response.status));
    const configuredLimit = Number(process.env.AGENT_CONTEXT_INCIDENT_LIMIT || 30);
    const incidentLimit = Math.min(Math.max(Number.isFinite(configuredLimit) ? Math.floor(configuredLimit) : 30, 10), 100);
    const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const contextIncidents = [...active]
      .sort((left, right) => {
        const severity = (severityRank[left.response.severity] ?? 3) - (severityRank[right.response.severity] ?? 3);
        if (severity !== 0) return severity;
        if (left.response.nextBooking !== right.response.nextBooking) return left.response.nextBooking - right.response.nextBooking;
        return right.createdAt.localeCompare(left.createdAt);
      })
      .slice(0, incidentLimit);
    const context = {
      generatedAt: new Date().toISOString(),
      incidentSummary: {
        total: incidents.length,
        active: active.length,
        includedActiveIncidents: contextIncidents.length,
        highPriority: active.filter(item => item.response.severity === 'high').length
      },
      activeIncidents: contextIncidents.map(({ response: item }) => ({ id: item.id, plate: item.plate, station: item.station, label: item.label, severity: item.severity, status: item.status, score: item.score, nextBooking: item.nextBooking, assignee: item.assignee })),
      damageHotspots: JSON.parse(this.repo.getSetting('damageHotspots', '[]')),
      opsMetrics: this.getOpsMetrics()
    };
    return this.aiAgent.analyze(prompt, context);
  }

  public queueLineTest(message: string) {
    return this.notifications.queueLineMessage(null, 'test', message || 'iRent LINE Bot test notification.');
  }

  public verifyLineWebhook(rawBody: Buffer, signature: string | undefined) {
    return this.notifications.verifyWebhookSignature(rawBody, signature);
  }

  public captureLineWebhookTargets(body: any) {
    return this.notifications.captureWebhookTargets(body);
  }

  public getNotificationStats() {
    return this.repo.getNotificationStats();
  }

  public notifyLine(incidentId: string | null, eventType: string, message: string) {
    return this.notifications.queueLineMessage(incidentId, eventType, message);
  }

  public getLineMessage(incident: IncidentResponse, eventType: string, extra = ""): string {
    const headlineMap: Record<string, string> = {
      ai_detected: 'AI detected a new incident', dispatch: 'Incident assigned', comment: 'New incident comment',
      in_progress: 'Incident in progress', resolved: 'Incident resolved', reopen: 'Incident reopened',
      maintenance_report: 'Maintenance report uploaded'
    };
    const lines = [
      `【${headlineMap[eventType] || 'iRent operations notification'}】`,
      `Vehicle: ${incident.plate}`,
      `Incident ID: ${incident.id}`,
      `Incident: ${incident.label}`,
      `Station: ${incident.station}`,
      `AI confidence: ${incident.confidence}%`,
      `Urgency: ${incident.urgencyScore}/10 (${incident.issueCount} findings)`,
      `Status: ${incident.status}`,
      `Assignee: ${incident.assignee}`
    ];
    if (extra) lines.push(`Note: ${extra}`);
    return lines.join('\n');
  }

  // --- Photo Quality and Scenario Seeding ---
  private async savePhotoFile(prefix: string, image: { buffer: Buffer; extension: string }): Promise<string> {
    const storedName = `${prefix}_${randomBytes(8).toString('base64url')}${image.extension}`;
    const filePath = path.join(this.uploadDir, storedName);
    await fs.promises.writeFile(filePath, image.buffer, { flag: 'wx' });
    return `uploads/${storedName}`;
  }

  private async saveValidatedPhotoFile(prefix: string, _filename: string, dataUrl: string): Promise<string> {
    if (!dataUrl) return "";
    const image = await validateImageDataUrl(dataUrl);
    return this.savePhotoFile(prefix, image);
  }

  public runQualityCheck(filename: string, slot: string, contentText: string) {
    const text = `${filename} ${slot} ${contentText}`.toLowerCase();
    const plateVisible = !text.includes("no_plate");
    const angleValid = !text.includes("bad_angle");
    const distanceValid = !text.includes("too_close") && !text.includes("too_far");
    const passed = plateVisible && angleValid && distanceValid;
    const message = passed ? "照片品質通過" : "照片品質不足，請重新拍攝";

    return {
      passed,
      plateVisible,
      angleValid,
      distanceValid,
      message
    };
  }

  public async handleQualityCheckAction(payload: any, userId: number) {
    const photoId = this.createOpaqueId('PHOTO');
    const image = await analyzeImageQuality(payload.imageData || payload.data || "");
    const relativePath = await this.savePhotoFile(photoId, image);

    // Client-side scores are deliberately ignored. This validation result is based only on
    // server-decoded bytes and is persisted before the photo can be attached to a submission.
    const supplemental = this.runQualityCheck(payload.filename || '', payload.slot || '', String(payload.note || ''));
    const passed = image.blur.passed && supplemental.passed;
    const quality = {
      passed,
      blur: image.blur,
      plateVisible: supplemental.plateVisible,
      angleValid: supplemental.angleValid,
      distanceValid: supplemental.distanceValid,
      message: passed ? '照片品質通過' : image.blur.passed ? '照片品質不足，請重新拍攝' : '照片過於模糊，請重新拍攝'
    };

    this.repo.insertUploadedPhoto({
      photo_id: photoId,
      submission_id: payload.submissionId || null,
      rental_id: payload.rentalId || payload.rental_id || '',
      plate: payload.plate || '',
      phase: payload.phase || 'pickup',
      slot: payload.slot || 'front',
      filename: payload.filename || `${photoId}.jpg`,
      file_path: relativePath,
      quality_passed: quality.passed ? 1 : 0,
      blur_score: image.blur.score,
      blur_threshold: image.blur.threshold,
      blur_checked_at: new Date().toISOString(),
      is_blur: image.blur.passed ? 0 : 1,
      plate_visible: quality.plateVisible ? 1 : 0,
      angle_valid: quality.angleValid ? 1 : 0,
      distance_valid: quality.distanceValid ? 1 : 0,
      ai_result_json: '',
      user_id: userId
    });

    return {
      photoId,
      quality,
      photo: dbRowToPhotoResponse(this.repo.getUploadedPhotoById(photoId)!)
    };
  }

  public async handleOrientationCheckAction(payload: any, userId: number) {
    const orientation = await analyzeOrientation(String(payload?.imageData || payload?.data || ''));
    const photoId = payload?.photoId ? String(payload.photoId) : undefined;
    if (photoId) {
      if (!this.repo.userOwnsPhoto(userId, photoId)) {
        const error: any = new Error('Photo not found'); error.status = 404; throw error;
      }
      this.repo.updatePhotoOrientation(photoId, orientation, userId);
    }
    return { orientation, photoId };
  }

  public async handleCaptureGuidanceAction(payload: any, userId: number) {
    const photoId = String(payload?.photoId || '');
    if (!photoId || !this.repo.userOwnsPhoto(userId, photoId)) {
      const error: any = new Error('Photo not found'); error.status = 404; throw error;
    }
    const guidance = await analyzeCaptureGuidance(String(payload?.imageData || payload?.data || ''));
    const persisted = normalizeGuidance(guidance);
    this.repo.updatePhotoGuidance(photoId, persisted, userId);
    return { guidance: { ...guidance, ...persisted }, photoId };
  }

  public async handleConditionCheckAction(payload: any, userId: number) {
    const photoId = String(payload?.photoId || '');
    const photo = photoId ? this.repo.getUploadedPhotoById(photoId) : null;
    if (!photo || photo.user_id !== userId) {
      const error: any = new Error('Photo not found'); error.status = 404; throw error;
    }
    if (!photo.quality_passed || photo.is_blur || !photo.file_path) {
      const error: any = new Error('Photo has not passed quality validation'); error.status = 422; error.code = 'IMAGE_QUALITY_CHECK_FAILED'; throw error;
    }
    const absolutePath = path.join(this.uploadDir, path.basename(photo.file_path));
    const extension = path.extname(absolutePath).toLowerCase();
    const mime = extension === '.png' ? 'png' : extension === '.webp' ? 'webp' : 'jpeg';
    const imageData = `data:image/${mime};base64,${(await fs.promises.readFile(absolutePath)).toString('base64')}`;
    const checkedAt = new Date().toISOString();
    try {
      const condition = await analyzeVehicleCondition(imageData);
      const persistedDamage: PersistedDamageResult = {
        schema_version: 'irent.damage.v1', photoId,
        damage_status: condition.damage.detected ? 'detected' : 'none',
        detection_count: condition.detections.length,
        confidence: condition.damage.detected ? condition.damage.confidence : null,
        detections: condition.detections,
        inference_status: 'success', failure_reason: null, checked_at: checkedAt
      };
      this.repo.updatePhotoCondition(photoId, { ...condition, persistedDamage }, userId);
      return { condition, damage: persistedDamage, photoId };
    } catch (error: any) {
      const persistedDamage: PersistedDamageResult = {
        schema_version: 'irent.damage.v1', photoId, damage_status: 'unavailable',
        detection_count: 0, confidence: null, detections: [], inference_status: 'failed',
        failure_reason: error?.code || 'DAMAGE_INFERENCE_FAILED', checked_at: checkedAt
      };
      this.repo.updatePhotoCondition(photoId, { damage: { detected: false, confidence: 0 }, dirty: { detected: false, confidence: 0 }, persistedDamage }, userId);
      return { condition: null, damage: persistedDamage, photoId };
    }
  }

  public createIncidentFromAiResult(submission: any, aiResults: any[], userId: number, submissionId: string): string[] {
      // A submission is the unit of work: retain each finding in the timeline,
      // but create one incident/task/notification for the complete set of photos.
      const findings = aiResults.filter(result => result.damageDetected || result.cleanliness === 'dirty');
      if (!findings.length) return [];
      const incidentId = this.createOpaqueId('INC-AI');
      const isDirty = !findings.some(result => result.damageDetected);
      const label = [...new Set(findings.flatMap(result => [
        ...(result.damageDetected ? [`${result.damageLocation || result.slot} 車損`] : []),
        ...(result.cleanliness === 'dirty' ? [`${result.slot} 清潔異常`] : [])
      ]))].join('；');
      const confidence = Math.round(Math.max(...findings.map(result => result.confidence || 0)) * 100);
      const urgency = incidentUrgency(findings);

      const scoreInput = {
        type: isDirty ? "cleaning" : "damage",
        next_booking: 24,
        hot_station: 1,
        confidence,
        severity: urgency.severity
      };

      const score = this.calculateScore(scoreInput);

      const item: Partial<Incident> = {
        id: incidentId,
        plate: submission.plate || "UNKNOWN",
        station: submission.station || submission.parkingLocation || "租客回報位置",
        type: isDirty ? "cleaning" : "damage",
        label,
        severity: urgency.severity,
        confidence,
        detected_time: new Date().toLocaleTimeString('zh-TW', { hour12: false }).substring(0, 5),
        next_booking: 24,
        hot_station: 1,
        map_x: 24 + Math.floor(Math.random() * 52),
        map_y: 24 + Math.floor(Math.random() * 52),
        status: "todo",
        score,
        owner_user_id: userId,
        source_submission_id: submissionId,
        latitude: submission.returnLocation?.latitude,
        longitude: submission.returnLocation?.longitude,
        gps_accuracy: submission.returnLocation?.gpsAccuracy,
        address: submission.returnLocation?.address,
        parking_facility: submission.returnLocation?.parkingFacility,
        floor: submission.returnLocation?.floor,
        zone: submission.returnLocation?.zone,
        pillar: submission.returnLocation?.pillar,
        parking_slot: submission.returnLocation?.parkingSlot,
        location_note: submission.returnLocation?.locationNote
      };

      this.repo.insertIncident(item);
      this.repo.updateIncidentStatusAndAssignee(incidentId, 'todo', '待派工', {
        issue_count: urgency.issueCount, urgency_score: urgency.urgencyScore
      });

      for (const result of findings) this.repo.addTimeline(
        incidentId,
        "photo_ai_analysis",
        "Photo AI Analysis",
        `submissionId=${submissionId} rentalId=${submission.rental_id || submission.rentalId} phase=${submission.phase} slot=${result.slot} damage=${Boolean(result.damageDetected)} dirty=${result.cleanliness === 'dirty'}`
      );

      return [incidentId];
  }

  public async handlePhotoSubmissionAction(payload: any, userId: number) {
    const submissionId = this.createOpaqueId('SUB');
    const photos: any[] = Array.isArray(payload.photos) ? payload.photos : [];
    const phase = String(payload.phase || 'return');
    const requiredSlots = ['front', 'right_side', 'rear', 'left_side', 'front_interior', 'backseat_interior'];
    const receivedSlots = photos.map(photo => String(photo?.slot || ''));
    const hasExactlyRequiredSlots = photos.length === requiredSlots.length
      && new Set(receivedSlots).size === requiredSlots.length
      && requiredSlots.every(slot => receivedSlots.includes(slot));
    if (!hasExactlyRequiredSlots) {
      const error: any = new Error('所有必填照片都必須完成品質檢查');
      error.code = 'IMAGE_QUALITY_CHECK_FAILED';
      error.status = 422;
      throw error;
    }

    const savedPhotos: any[] = [];
    for (const photoRequest of photos) {
      const photoId = String(photoRequest?.photoId || '');
      const photo = photoId ? this.repo.getUploadedPhotoById(photoId) : null;
      const matchesSubmission = photo
        && photo.user_id === userId
        && !photo.submission_id
        && photo.rental_id === String(payload.rentalId || '')
        && photo.plate === String(payload.plate || '')
        && photo.phase === String(payload.phase || 'return')
        && photo.slot === String(photoRequest.slot || '');
      if (!matchesSubmission || !photo!.quality_passed || photo!.is_blur || photo!.blur_score === null || !photo!.blur_checked_at) {
        const error: any = new Error('照片尚未通過品質檢查');
        error.code = 'IMAGE_QUALITY_CHECK_FAILED';
        error.status = 422;
        throw error;
      }
      savedPhotos.push(photo);
    }

    const savedGuidance = savedPhotos.map(photo => {
      try { return normalizeGuidance(JSON.parse(photo.ai_result_json || '{}').guidance); }
      catch { return normalizeGuidance(null); }
    }) as PersistedGuidance[];
    const coverageSummary = calculateCoverage(savedGuidance);

    const returnLocation = validateReturnLocation(payload.returnLocation, phase === 'return');

    const submissionObj = {
      submission_id: submissionId,
      rental_id: payload.rentalId || "",
      plate: payload.plate || "",
      phase,
      station: returnLocation?.station || payload.station || payload.location || "",
      parking_location: returnLocation?.parkingSlot || payload.parkingLocation || "",
      returnLocation,
      photos
    };

    const damageResults: PersistedDamageResult[] = savedPhotos.map(photo => {
      try {
        const saved = JSON.parse(photo.ai_result_json || '{}').damage;
        if (saved?.schema_version === 'irent.damage.v1' && saved.photoId === photo.photo_id) return saved;
      } catch { /* represented as unavailable below */ }
      return {
        schema_version: 'irent.damage.v1', photoId: photo.photo_id, damage_status: 'unavailable',
        detection_count: 0, confidence: null, detections: [], inference_status: 'failed',
        failure_reason: 'INFERENCE_NOT_RUN', checked_at: new Date().toISOString()
      } as PersistedDamageResult;
    });
    const aiResults = damageResults.map((damage, index) => ({
      slot: savedPhotos[index].slot,
      damageDetected: damage.inference_status === 'success' && damage.damage_status === 'detected',
      damageType: damage.detections[0]?.label || null,
      damageLocation: savedPhotos[index].slot,
      isNewDamage: damage.inference_status === 'success' && damage.damage_status === 'detected' && phase === 'return',
      confidence: damage.confidence || 0,
      cleanliness: savedPhotos[index].dirty_detected === 1 ? 'dirty' : 'unknown',
      damage
    }));
    const damageSummary = {
      schema_version: 'irent.damage-summary.v1',
      detected_photo_count: damageResults.filter(item => item.damage_status === 'detected').length,
      total_detection_count: damageResults.reduce((sum, item) => sum + item.detection_count, 0),
      unavailable_photo_count: damageResults.filter(item => item.inference_status === 'failed').length,
      photos: damageResults
    };
    const createdIncidents = this.createIncidentFromAiResult(submissionObj, aiResults, userId, submissionId);

    const overallStatus = createdIncidents.length > 0 ? "warning" : "ok";
    const status = createdIncidents.length > 0 ? "incident_created" : "clear";
    const aiSummary = createdIncidents.length > 0
      ? `AI found issues in ${damageSummary.detected_photo_count} photo(s); one incident created: ${createdIncidents[0]}`
      : "AI review found no new damage or cleanliness blocker.";

    // Insert photo submission row
    this.repo.insertPhotoSubmission({
      submission_id: submissionId,
      rental_id: payload.rentalId || "",
      plate: payload.plate || "",
      phase,
      station: returnLocation?.station || payload.station || payload.location || "",
      parking_location: returnLocation?.parkingSlot || payload.parkingLocation || "",
      status,
      overall_status: overallStatus,
      ai_summary: aiSummary,
      coverage_summary_json: JSON.stringify(coverageSummary),
      damage_summary_json: JSON.stringify(damageSummary),
      user_id: userId,
      latitude: returnLocation?.latitude,
      longitude: returnLocation?.longitude,
      gps_accuracy: returnLocation?.gpsAccuracy,
      gps_captured_at: returnLocation?.gpsCapturedAt,
      address: returnLocation?.address,
      parking_facility: returnLocation?.parkingFacility,
      floor: returnLocation?.floor,
      zone: returnLocation?.zone,
      pillar: returnLocation?.pillar,
      parking_slot: returnLocation?.parkingSlot,
      location_note: returnLocation?.locationNote
    });

    // Save individual photos
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      this.repo.updateUploadedPhotoSubmission(p.photoId, submissionId, '', userId);
    }

    if (createdIncidents.length > 0) {
      const incident = dbRowToIncidentResponse(this.repo.getIncidentById(createdIncidents[0])!);
      this.notifyLine(incident.id, 'ai_detected', this.getLineMessage(incident, 'ai_detected', `Submission: ${submissionId}; ${damageSummary.detected_photo_count} abnormal photo(s)`));
    }

    return {
      submissionId,
      overallStatus,
      coverageSummary,
      damageSummary,
      results: aiResults,
      createdIncidents,
      submission: dbRowToSubmissionResponse(this.repo.getPhotoSubmissionDetail(submissionId)!),
      photos: this.repo.getUploadedPhotosBySubmission(submissionId).map(dbRowToPhotoResponse),
      incidents: createdIncidents.map(id => dbRowToIncidentResponse(this.repo.getIncidentById(id)!))
    };
  }

  // --- Operations Actions ---
  private async runAiReview(incident: Incident, note: string, photoPath: string) {
    const text = (note || "").toLowerCase();
    const failWords = ["fail", "異常", "未完成", "仍有", "不通過", "髒", "破損"];
    const hasFail = failWords.some(word => text.includes(word));

    if (hasFail) {
      return {
        result: "fail",
        confidence: 82,
        summary: "AI Review found unresolved issue signals in the team note. Human confirmation is required."
      };
    }
    if (!photoPath) {
      return {
        result: "uncertain",
        confidence: 78,
        summary: "AI Review needs a completion photo before it can safely close this incident."
      };
    }
    try {
      const sourcePhoto = incident.source_submission_id
        ? this.repo.getUploadedPhotosBySubmission(incident.source_submission_id).find(photo => Boolean(photo.file_path))
        : undefined;
      const images = [
        ...(sourcePhoto?.file_path ? [{ label: `原 Incident 照片：${incident.label}`, dataUrl: this.localImageDataUrl(sourcePhoto.file_path) }] : []),
        { label: '維修完工照片', dataUrl: this.localImageDataUrl(photoPath) }
      ].slice(-2);
      const result = await this.aiAgent.analyzeImages(
        `覆核 Incident ${incident.id}（${incident.label}）的維修完工照片。維修備註：${note || '未提供'}。檢查是否對應原損傷位置、備註是否一致及是否仍有未處理項目。`,
        images
      );
      return {
        result: result.review.decision,
        confidence: result.review.confidence,
        summary: `${result.review.summary}${result.review.suspectedRegions.length ? ` 可疑區域：${result.review.suspectedRegions.map(region => region.label).join('、')}` : ''}`
      };
    } catch (error: any) {
      return {
        result: 'human_review',
        confidence: 0,
        summary: error.message === 'GEMINI_API_KEY_NOT_CONFIGURED'
          ? 'Vision model is not configured. Human confirmation is required.'
          : 'Vision review could not be completed safely. Human confirmation is required.'
      };
    }
  }

  public async handleAction(payload: any, actor?: SafeUser) {
    const action = payload.action;
    const incidentId = payload.incidentId;

    const incident = this.repo.getIncidentById(incidentId);
    if (!incident) {
      return { status: 404, ok: false, error: "Incident not found" };
    }

    const incidentRes = dbRowToIncidentResponse(incident);

    if (action === 'assign_self' || (action === 'dispatch' && payload.assigneeUserId !== undefined)) {
      if (!actor || actor.role !== 'admin') return { status: 403, ok: false, error: 'Admin login required' };
      const userId = action === 'assign_self' ? actor.id : payload.assigneeUserId;
      if (!Number.isInteger(userId)) return { status: 400, ok: false, error: 'Select a valid operator' };
      const assignee = this.repo.getUserById(userId);
      if (!assignee || !assignee.is_active || assignee.role !== 'admin') return { status: 400, ok: false, error: 'Assignee must be an active admin' };
      if (incident.status === 'assigned' && incident.assigned_user_id === assignee.id) {
        return { status: 200, ok: true, incident: incidentRes };
      }
      if (!this.repo.assignIncidentToUser(incidentId, assignee, action === 'assign_self')) {
        return { status: 409, ok: false, error: '案件已被領取或狀態已變更，請重新整理後再操作。' };
      }
      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      this.notifyLine(incidentId, 'dispatch', this.getLineMessage(updated, 'dispatch', `Assigned by ${actor.username}`));
    } else if (action === "dispatch") {
      if (!['todo', 'assigned'].includes(incident.status) || incident.assigned_user_id) {
        return { status: 409, ok: false, error: '案件已有指定人員或已開始處理，請使用指定人員派工。' };
      }
      const [team, region] = this.repo.assignTeam(incident.station);
      this.repo.updateIncidentStatusAndAssignee(incidentId, "assigned", team, {
        assigned_team: team,
        region,
        manual_review_required: 0
      });
      this.repo.updateDispatchTaskStatus(incidentId, "assigned", team);
      this.repo.addTimeline(incidentId, "assigned", "Reassigned", `${region} / ${team}`);

      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      this.notifyLine(incidentId, "dispatch", this.getLineMessage(updated, "dispatch"));

    } else if (action === "comment") {
      const body = (payload.body || "").trim();
      const author = (payload.author || "客服").trim();
      if (!body) {
        return { status: 400, ok: false, error: "Comment body is required" };
      }
      this.repo.addComment(incidentId, author, body);
      this.repo.addTimeline(incidentId, "comment", "Comment", `${author}: ${body}`);
      this.notifyLine(incidentId, "comment", this.getLineMessage(incidentRes, "comment", body));

    } else if (action === "in_progress") {
      this.repo.updateIncidentStatusAndAssignee(incidentId, "in_progress", incident.assignee);
      this.repo.updateDispatchTaskStatus(incidentId, "in_progress");
      this.repo.addTimeline(incidentId, "in_progress", "In Progress", "Task started");

      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      this.notifyLine(incidentId, "in_progress", this.getLineMessage(updated, "in_progress"));

    } else if (action === "resolve") {
      this.repo.updateIncidentStatusAndAssignee(incidentId, "resolved", "人工確認結案", {
        severity: "low",
        manual_review_required: 0,
        resolved_at: this.repo.nowText()
      });
      this.repo.updateDispatchTaskStatus(incidentId, "done");
      this.repo.addTimeline(incidentId, "resolved", "Manual Close", "Manual confirmed");

      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      this.notifyLine(incidentId, "resolved", this.getLineMessage(updated, "resolved"));

    } else if (action === "reopen") {
      if (!['resolved', 'done'].includes(incident.status)) return { status: 409, ok: false, error: 'Only closed incidents can be reopened' };
      const [team, region] = this.repo.assignTeam(incident.station);
      this.repo.updateIncidentStatusAndAssignee(incidentId, "assigned", team, {
        severity: "high",
        assigned_team: team,
        region,
        auto_closed: 0,
        manual_review_required: 0,
        resolved_at: null
        , assigned_user_id: null
      });
      // Re-open dispatch task status to assigned
      this.repo.updateDispatchTaskStatus(incidentId, "assigned", team);
      this.repo.addTimeline(incidentId, "reopen", "Reassigned", `${region} / ${team}`);

      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      this.notifyLine(incidentId, "reopen", this.getLineMessage(updated, "reopen"));

    } else if (action === "maintenance_report") {
      const note = (payload.note || "").trim();
      const photoPayload = payload.photo;
      const photoId = this.createOpaqueId(`MR-${incidentId}`);

      let savedPath = "";
      if (photoPayload) {
        savedPath = await this.saveValidatedPhotoFile(photoId, photoPayload.name || "report.jpg", photoPayload.data || "");
      }

      const review = await this.runAiReview(incident, note, savedPath);

      // Insert maintenance report
      this.repo.insertMaintenanceReport({
        incident_id: incidentId,
        photo_path: savedPath || null,
        result: review.result,
        note: note || null,
        ai_review_result: review.result,
        ai_review_confidence: review.confidence,
        ai_review_summary: review.summary
      });

      // Update incident details
      this.repo.updateIncidentStatusAndAssignee(incidentId, "waiting_review", incident.assignee, {
        ai_review_result: review.result,
        ai_review_confidence: review.confidence,
        ai_review_summary: review.summary,
        manual_review_required: 1
      });

      this.repo.addTimeline(incidentId, "maintenance_report", "Team Upload", note || "Completion photo uploaded");

      this.repo.addTimeline(incidentId, "ai_review_pending", "AI Review Needs Manual Check", `${review.result} / Confidence ${review.confidence}%`);

      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      this.notifyLine(incidentId, "maintenance_report", this.getLineMessage(updated, "maintenance_report", note || review.result));

    } else {
      return { status: 400, ok: false, error: "Unknown action" };
    }

    return { status: 200, ok: true, incident: dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!) };
  }
}
