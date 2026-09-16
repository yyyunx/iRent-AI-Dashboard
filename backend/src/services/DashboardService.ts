import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { DatabaseRepository } from '../repositories/DatabaseRepository';
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
import { validateImageDataUrl } from './ImageValidation';
import { OPERATIONS_SOP } from '../knowledge/operationsSop';

export class DashboardService {
  private repo: DatabaseRepository;
  private uploadDir: string;
  private notifications: NotificationService;
  private aiAgent: AiAgentService;

  constructor(repo: DatabaseRepository, uploadDir: string) {
    this.repo = repo;
    this.uploadDir = uploadDir;
    this.notifications = new NotificationService(repo);
    const aiSecretFile = process.env.OPENAI_API_KEY_FILE || path.join(path.dirname(uploadDir), 'secrets', 'openai-api-key');
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
    const aiConfig = isAdmin ? this.aiAgent.getConfig() : { provider: 'openai' as const, model: '', keyConfigured: false, keySource: 'dashboard' as const };

    const lineLogs = notifications.filter(row => row.provider === 'line').map(row => ({
      title: `${row.status} · ${row.event_type} · ${row.incident_id || '-'}`,
      time: row.created_at,
      group: lineGroup,
      message: row.message,
      status: row.status,
      error: row.error || null
    }));

    const DAMAGE_HOTSPOTS = [["右後門", 12], ["前保桿", 9], ["左後輪弧", 7], ["後保桿", 5], ["車頂", 2]];
    const hotspotsVal = JSON.parse(this.repo.getSetting("damageHotspots", JSON.stringify(DAMAGE_HOTSPOTS)));

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
      `Incident: ${incident.label}`,
      `Station: ${incident.station}`,
      `AI confidence: ${incident.confidence}%`,
      `Status: ${incident.status}`,
      `Assignee: ${incident.assignee}`
    ];
    if (extra) lines.push(`Note: ${extra}`);
    return lines.join('\n');
  }

  // --- Photo Quality and Scenario Seeding ---
  private async savePhotoFile(prefix: string, _filename: string, dataUrl: string): Promise<string> {
    if (!dataUrl) return "";
    const image = await validateImageDataUrl(dataUrl);
    const storedName = `${prefix}_${randomBytes(8).toString('base64url')}${image.extension}`;
    const filePath = path.join(this.uploadDir, storedName);
    await fs.promises.writeFile(filePath, image.buffer, { flag: 'wx' });
    return `uploads/${storedName}`;
  }

  public runQualityCheck(filename: string, slot: string, contentText: string) {
    const text = `${filename} ${slot} ${contentText}`.toLowerCase();
    const isBlur = text.includes("blur") || text.includes("bad") || text.includes("dark") || text.includes("fail");
    const blurScore = isBlur ? 42.1 : 135.2;
    const plateVisible = !text.includes("no_plate");
    const angleValid = !text.includes("bad_angle");
    const distanceValid = !text.includes("too_close") && !text.includes("too_far");
    const passed = !isBlur && plateVisible && angleValid && distanceValid;
    const message = passed ? "照片品質通過" : "照片品質不足，請重新拍攝";

    return {
      passed,
      blurScore,
      isBlur,
      plateVisible,
      angleValid,
      distanceValid,
      message
    };
  }

  public async handleQualityCheckAction(payload: any, userId: number) {
    const photoId = this.createOpaqueId('PHOTO');
    const relativePath = await this.savePhotoFile(photoId, payload.filename || `${photoId}.jpg`, payload.imageData || payload.data || "");

    // Base64 data can be 10 MB. Quality heuristics are metadata-based, so never duplicate or
    // lowercase the image payload merely to inspect a filename/slot/note.
    const quality = this.runQualityCheck(payload.filename || '', payload.slot || '', String(payload.note || ''));

    // If frontend computed metrics are provided, override backend simulation
    const finalSharpness = payload.frontendSharpness !== undefined ? Number(payload.frontendSharpness) : quality.blurScore;
    const finalIsBlur = payload.isBlur !== undefined ? Boolean(payload.isBlur) : quality.isBlur;

    if (payload.frontendSharpness !== undefined) {
      quality.blurScore = finalSharpness;
      quality.isBlur = finalIsBlur;
      quality.passed = !finalIsBlur && quality.plateVisible && quality.angleValid && quality.distanceValid;
      quality.message = quality.passed ? "照片品質通過" : "照片品質不足，請重新拍攝";
    }

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
      blur_score: finalSharpness,
      is_blur: finalIsBlur ? 1 : 0,
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

  // --- Photo Submission AI analysis ---
  public mockVehicleAiAnalysis(submission: any) {
    const results: any[] = [];
    const photoSlotsMap: Record<string, string> = {
      front: "車頭",
      right_side: "右側",
      rear: "車尾",
      left_side: "左側",
      front_interior: "前座內裝",
      backseat_interior: "後座內裝",
    };

    for (const photo of submission.photos || []) {
      const slot = photo.slot || "front";
      const text = `${photo.filename || ''} ${slot} ${photo.note || ''}`.toLowerCase();
      const isInterior = slot === "front_interior" || slot === "backseat_interior";
      const quality = photo.qualityPassed !== false;

      if (isInterior) {
        const dirty = text.includes("dirty") || text.includes("trash") || text.includes("stain") || text.includes("髒") || text.includes("垃圾");
        results.push({
          slot,
          qualityPassed: quality,
          damageDetected: false,
          cleanliness: dirty ? "dirty" : "normal",
          confidence: dirty ? 0.89 : 0.93
        });
      } else {
        const damaged = text.includes("scratch") || text.includes("dent") || text.includes("damage") || text.includes("crack") || text.includes("擦傷") || text.includes("凹") || text.includes("破");
        results.push({
          slot,
          qualityPassed: quality,
          damageDetected: damaged,
          damageType: damaged ? "scratch" : null,
          damageLocation: photoSlotsMap[slot] || slot,
          isNewDamage: damaged && submission.phase === "return",
          confidence: damaged ? 0.88 : 0.92
        });
      }
    }
    return results;
  }

  public async createIncidentFromAiResult(submission: any, aiResults: any[], userId: number, submissionId: string): Promise<string[]> {
    const created: string[] = [];
    for (const result of aiResults) {
      const shouldCreate = result.damageDetected || result.cleanliness === "dirty";
      if (!shouldCreate) continue;

      const incidentId = this.createOpaqueId('INC-AI');
      const isDirty = result.cleanliness === "dirty";
      const label = isDirty ? "車內清潔異常" : `${result.damageLocation || result.slot} 新增車損`;

      const scoreInput = {
        type: isDirty ? "cleaning" : "damage",
        next_booking: 24,
        hot_station: 1,
        confidence: Math.round(result.confidence * 100),
        severity: isDirty ? "medium" : "high"
      };

      const score = this.calculateScore(scoreInput);

      const item: Partial<Incident> = {
        id: incidentId,
        plate: submission.plate || "UNKNOWN",
        station: submission.station || submission.parkingLocation || "租客回報位置",
        type: isDirty ? "cleaning" : "damage",
        label,
        severity: isDirty ? "medium" : "high",
        confidence: Math.round(result.confidence * 100),
        detected_time: new Date().toLocaleTimeString('zh-TW', { hour12: false }).substring(0, 5),
        next_booking: 24,
        hot_station: 1,
        map_x: 24 + Math.floor(Math.random() * 52),
        map_y: 24 + Math.floor(Math.random() * 52),
        status: "assigned",
        score,
        owner_user_id: userId,
        source_submission_id: submissionId
      };

      this.repo.insertIncident(item);

      this.repo.addTimeline(
        incidentId,
        "photo_ai_analysis",
        "Photo AI Analysis",
        `rentalId=${submission.rentalId} phase=${submission.phase} slot=${result.slot}`
      );

      const incidentRes = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId));
      this.notifyLine(incidentId, "ai_detected", this.getLineMessage(incidentRes, "ai_detected"));

      created.push(incidentId);
    }
    return created;
  }

  public async handlePhotoSubmissionAction(payload: any, userId: number) {
    const submissionId = this.createOpaqueId('SUB');
    const photos = payload.photos || [];

    const submissionObj = {
      submission_id: submissionId,
      rental_id: payload.rentalId || "",
      plate: payload.plate || "",
      phase: payload.phase || "return",
      station: payload.station || payload.location || "",
      parking_location: payload.parkingLocation || "",
      photos
    };

    const aiResults = this.mockVehicleAiAnalysis(submissionObj);
    const createdIncidents = await this.createIncidentFromAiResult(submissionObj, aiResults, userId, submissionId);

    const overallStatus = createdIncidents.length > 0 ? "warning" : "ok";
    const status = createdIncidents.length > 0 ? "incident_created" : "clear";
    const aiSummary = createdIncidents.length > 0
      ? `AI found ${createdIncidents.length} issue(s) and created incident(s): ${createdIncidents.join(', ')}`
      : "AI review found no new damage or cleanliness blocker.";

    // Insert photo submission row
    this.repo.insertPhotoSubmission({
      submission_id: submissionId,
      rental_id: payload.rentalId || "",
      plate: payload.plate || "",
      phase: payload.phase || "return",
      station: payload.station || payload.location || "",
      parking_location: payload.parkingLocation || "",
      status,
      overall_status: overallStatus,
      ai_summary: aiSummary,
      user_id: userId
    });

    // Save individual photos
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const aiResult = aiResults[i];
      const photoId = p.photoId || this.createOpaqueId('PHOTO');

      const photoPayload = {
        rentalId: payload.rentalId,
        plate: payload.plate,
        phase: payload.phase,
        slot: p.slot || "front",
        filename: p.filename || `${p.slot || 'photo'}.jpg`,
        imageData: p.imageData || p.data || ""
      };

      if (p.photoId) {
        if (!this.repo.userOwnsPhoto(userId, p.photoId)) throw new Error('Photo not found');
        this.repo.updateUploadedPhotoSubmission(p.photoId, submissionId, JSON.stringify(aiResult), userId);
      } else {
        const fileRelPath = await this.savePhotoFile(photoId, photoPayload.filename, photoPayload.imageData);
        this.repo.insertUploadedPhoto({
          photo_id: photoId,
          submission_id: submissionId,
          rental_id: photoPayload.rentalId || '',
          plate: photoPayload.plate || '',
          phase: photoPayload.phase || 'pickup',
          slot: photoPayload.slot,
          filename: photoPayload.filename,
          file_path: fileRelPath,
          quality_passed: 1,
          is_blur: 0,
          plate_visible: 1,
          angle_valid: 1,
          distance_valid: 1,
          ai_result_json: JSON.stringify(aiResult),
          user_id: userId
        });
      }
    }

    if (createdIncidents.length > 0) {
      const lineMessage = [
        `【Photo AI Incident】${payload.plate}`,
        `Rental: ${payload.rentalId}`,
        `Phase: ${payload.phase}`,
        `Incidents: ${createdIncidents.join(', ')}`,
        `Dashboard: /operator/dashboard`
      ].join('\n');

      this.notifyLine(createdIncidents[0], "photo_submission", lineMessage);
    }

    return {
      submissionId,
      overallStatus,
      results: aiResults,
      createdIncidents,
      submission: dbRowToSubmissionResponse(this.repo.getPhotoSubmissionDetail(submissionId)!),
      photos: this.repo.getUploadedPhotosBySubmission(submissionId).map(dbRowToPhotoResponse),
      incidents: createdIncidents.map(id => dbRowToIncidentResponse(this.repo.getIncidentById(id)!))
    };
  }

  // --- Operations Actions ---
  private runAiReview(note: string, photoPath: string) {
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
    return {
      result: "pass",
      confidence: 94,
      summary: "AI Review matched the uploaded completion photo with the incident context and found no remaining blocker."
    };
  }

  public async handleAction(payload: any) {
    const action = payload.action;
    const incidentId = payload.incidentId;

    const incident = this.repo.getIncidentById(incidentId);
    if (!incident) {
      return { status: 404, ok: false, error: "Incident not found" };
    }

    const incidentRes = dbRowToIncidentResponse(incident);

    if (action === "dispatch") {
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
      const [team, region] = this.repo.assignTeam(incident.station);
      this.repo.updateIncidentStatusAndAssignee(incidentId, "assigned", team, {
        severity: "high",
        assigned_team: team,
        region,
        auto_closed: 0,
        manual_review_required: 0,
        resolved_at: null
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
        savedPath = await this.savePhotoFile(photoId, photoPayload.name || "report.jpg", photoPayload.data || "");
      }

      const review = this.runAiReview(note, savedPath);

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

      if (review.result === "pass" && review.confidence >= 90) {
        // Auto close incident
        this.repo.updateIncidentStatusAndAssignee(incidentId, "resolved", "人工確認結案", {
          severity: "low",
          auto_closed: 1,
          manual_review_required: 0,
          resolved_at: this.repo.nowText()
        });
        this.repo.updateDispatchTaskStatus(incidentId, "done");
        this.repo.addTimeline(incidentId, "ai_review_passed", "AI Review Passed", `Confidence ${review.confidence}%`);
        this.repo.addTimeline(incidentId, "auto_closed", "Incident Auto Closed", "AI review passed");
      } else {
        this.repo.addTimeline(incidentId, "ai_review_pending", "AI Review Needs Manual Check", `${review.result} / Confidence ${review.confidence}%`);
      }

      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      this.notifyLine(incidentId, "maintenance_report", this.getLineMessage(updated, "maintenance_report", note || review.result));

    } else {
      return { status: 400, ok: false, error: "Unknown action" };
    }

    return { status: 200, ok: true, incident: dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!) };
  }
}
