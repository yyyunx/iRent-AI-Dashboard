import { Request, Response } from 'express';
import path from 'path';
import { DatabaseRepository } from '../repositories/DatabaseRepository';
import { DashboardService } from '../services/DashboardService';
import { dbRowToIncidentResponse, dbRowToSubmissionResponse, dbRowToPhotoResponse } from '../models/types';

export class DashboardController {
  constructor(
    private readonly repo: DatabaseRepository,
    private readonly service: DashboardService,
    private readonly uploadDir: string
  ) {}

  public getProjectState = async (req: Request, res: Response) => {
    try {
      res.json(this.service.getProjectState(req.authUser!));
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to get state' });
    }
  };

  public getPhotoSubmissions = async (req: Request, res: Response) => {
    try {
      const rawLimit = Number(req.query.limit ?? 50);
      const rawOffset = Number(req.query.offset ?? 0);
      const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
      const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
      const pageRows = req.authUser!.role === 'admin'
        ? this.repo.getPhotoSubmissions(limit + 1, offset)
        : this.repo.getPhotoSubmissionsForUser(req.authUser!.id, limit + 1, offset);
      const hasMore = pageRows.length > limit;
      const rows = pageRows.slice(0, limit);
      res.json({
        ok: true,
        submissions: rows.map(dbRowToSubmissionResponse),
        page: { limit, offset, hasMore }
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to get submissions' });
    }
  };

  public getPhotoSubmissionDetail = async (req: Request, res: Response) => {
    try {
      const row = this.repo.getPhotoSubmissionDetail(req.params.submissionId);
      if (!row || (req.authUser!.role !== 'admin' && row.user_id !== req.authUser!.id)) {
        return res.status(404).json({ ok: false, error: 'Submission not found' });
      }
      const photos = this.repo.getUploadedPhotosBySubmission(req.params.submissionId).map(dbRowToPhotoResponse);
      res.json({ ok: true, submission: { ...dbRowToSubmissionResponse(row), photos } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to get submission details' });
    }
  };

  public insertIncident = async (req: Request, res: Response) => {
    const payload = req.body;
    try {
      const dbItem = {
        id: this.service.createOpaqueId('INC'), plate: payload.plate, station: payload.station, type: payload.type,
        label: payload.label, severity: payload.severity, confidence: Number(payload.confidence),
        detected_time: payload.time, next_booking: Number(payload.nextBooking ?? payload.next_booking ?? 24),
        hot_station: payload.hotStation ? 1 : 0, map_x: Number(payload.x ?? payload.map_x),
        map_y: Number(payload.y ?? payload.map_y), status: payload.status || 'todo', score: Number(payload.score || 0)
      };
      this.repo.insertIncident(dbItem);
      this.repo.addAuditLog(req.authUser!.id, 'CREATE_INCIDENT', 'incident', String(dbItem.id), {});
      res.json({
        ok: true,
        changedResource: { type: 'incident', data: dbRowToIncidentResponse(this.repo.getIncidentById(dbItem.id)!) },
        minimalSummary: { action: 'created', incidentId: dbItem.id }
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to insert incident' });
    }
  };

  public handleAction = async (req: Request, res: Response) => {
    const payload = req.body;
    try {
      const result = await this.service.handleAction(payload);
      if (!result.ok) return res.status(result.status || 400).json({ ok: false, error: result.error });
      const actions: Record<string, string> = {
        dispatch: 'DISPATCH_INCIDENT', resolve: 'RESOLVE_INCIDENT', reopen: 'REOPEN_INCIDENT',
        comment: 'COMMENT_INCIDENT', in_progress: 'START_INCIDENT', maintenance_report: 'MAINTENANCE_REPORT'
      };
      this.repo.addAuditLog(req.authUser!.id, actions[payload.action] || 'INCIDENT_ACTION', 'incident', String(payload.incidentId), { action: payload.action });
      res.json({
        ok: true,
        changedResource: { type: 'incident', data: result.incident },
        minimalSummary: { action: payload.action, incidentId: payload.incidentId }
      });
    } catch (e: any) {
      const status = ['Invalid image payload', 'Image exceeds 10 MB limit', 'Image MIME type does not match file signature', 'Image dimensions exceed limit', 'Image decode failed'].includes(e.message) ? 400 : 500;
      res.status(status).json({ ok: false, error: e.message || 'Failed to handle action' });
    }
  };

  public runQualityCheck = async (req: Request, res: Response) => {
    try {
      const result = await this.service.handleQualityCheckAction(req.body, req.authUser!.id);
      if (!result.quality.passed) {
        return res.status(422).json({
          ok: false,
          uploadId: result.photoId,
          photoId: result.photoId,
          quality: result.quality,
          error: { code: result.quality.blur.passed ? 'QUALITY_CHECK_FAILED' : 'IMAGE_TOO_BLURRY', message: result.quality.message },
          changedResource: { type: 'photo', data: result.photo }
        });
      }
      res.json({
        ok: true,
        uploadId: result.photoId,
        photoId: result.photoId,
        quality: result.quality,
        changedResource: { type: 'photo', data: result.photo },
        minimalSummary: { action: 'quality_checked', photoId: result.photoId }
      });
    } catch (e: any) {
      const status = e.status || (e.code === 'NO_VEHICLE_DETECTED' ? 422 : 500);
      const code = e.code || 'QUALITY_CHECK_FAILED';
      res.status(status).json({ ok: false, error: { code, message: e.message || '目前無法完成照片品質檢查，請重新嘗試。' } });
    }
  };

  public getIncidentMapMarkers = (_req: Request, res: Response) => {
    res.json({ ok: true, markers: this.service.getIncidentMapMarkers() });
  };

  public runOrientationCheck = async (req: Request, res: Response) => {
    try {
      const result = await this.service.handleOrientationCheckAction(req.body, req.authUser!.id);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(e.status || (e.code === 'ORIENTATION_MODEL_UNAVAILABLE' ? 503 : 500)).json({ ok: false, error: { code: e.code || 'ORIENTATION_CHECK_FAILED', message: e.message || 'Orientation analysis failed.' } });
    }
  };

  public runCaptureGuidance = async (req: Request, res: Response) => {
    try {
      const result = await this.service.handleCaptureGuidanceAction(req.body, req.authUser!.id);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      const unavailable = ['KPT_MODEL_UNAVAILABLE', 'AI_SERVICE_TIMEOUT', 'AI_SERVICE_ERROR'].includes(e.code);
      res.status(e.status || (unavailable ? 503 : 500)).json({ ok: false, error: { code: e.code || 'CAPTURE_GUIDANCE_FAILED', message: e.message || 'Capture guidance failed.' } });
    }
  };

  public runConditionCheck = async (req: Request, res: Response) => {
    try {
      const result = await this.service.handleConditionCheckAction(req.body, req.authUser!.id);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      const unavailable = ['DAMAGE_MODEL_UNAVAILABLE', 'AI_SERVICE_TIMEOUT', 'AI_SERVICE_ERROR'].includes(e.code);
      res.status(e.status || (unavailable ? 503 : 500)).json({ ok: false, error: { code: e.code || 'CONDITION_ANALYSIS_FAILED', message: e.message || 'Condition analysis failed.' } });
    }
  };

  public persistDamageLocalizations = (req: Request, res: Response) => {
    try {
      const result = this.service.persistDamageLocalizations(String(req.body?.photoId || ''), req.body?.events);
      res.json({ ok: true, events: result.events, changedResource: { type: 'photo', data: result.photo } });
    } catch (e: any) {
      res.status(e.status || 422).json({ ok: false, error: { code: 'DAMAGE_LOCALIZATION_INVALID', message: e.message || 'Invalid damage localization.' } });
    }
  };

  public handlePhotoSubmission = async (req: Request, res: Response) => {
    try {
      const result = await this.service.handlePhotoSubmissionAction(req.body, req.authUser!.id);
      res.json({
        ok: true,
        submissionId: result.submissionId,
        overallStatus: result.overallStatus,
        coverageSummary: result.coverageSummary,
        damageSummary: result.damageSummary,
        results: result.results,
        createdIncidents: result.createdIncidents,
        changedResource: {
          type: 'submission',
          data: { submission: result.submission, photos: result.photos, incidents: result.incidents }
        },
        minimalSummary: { action: 'submitted', submissionId: result.submissionId, createdIncidentCount: result.createdIncidents.length }
      });
    } catch (e: any) {
      const status = e.status || (e.message === 'Photo not found' ? 404 : 500);
      res.status(status).json({ ok: false, error: { code: e.code || 'SUBMISSION_FAILED', message: e.message || 'Failed to handle photo submission' } });
    }
  };

  public updateLineSettings = async (req: Request, res: Response) => {
    const { targetId, groupName, enabled } = req.body || {};
    if (targetId !== undefined && targetId !== '' && !/^[URC][A-Za-z0-9_-]{10,}$/.test(String(targetId))) {
      return res.status(400).json({ ok: false, error: 'LINE target ID must be a user, group, or room ID from a webhook event.' });
    }
    if (enabled !== undefined && typeof enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled must be true or false.' });
    try {
      this.service.updateLineSettings({
        targetId: targetId === undefined ? undefined : String(targetId),
        groupName: groupName === undefined ? undefined : String(groupName), enabled
      });
      this.repo.addAuditLog(req.authUser!.id, 'LINE_CONFIG_CHANGE', 'settings', 'line', { enabled });
      res.json({ ok: true, changedResource: { type: 'settings', key: 'line', data: this.service.getLineConfig() }, minimalSummary: { action: 'line_settings_updated' } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to update LINE settings' });
    }
  };

  public updateAiSettings = async (req: Request, res: Response) => {
    const { apiKey, model, clearApiKey } = req.body || {};
    if (apiKey !== undefined && apiKey !== '' && (typeof apiKey !== 'string' || apiKey.trim().length < 20)) {
      return res.status(400).json({ ok: false, error: 'API Key 格式不正確。' });
    }
    if (model !== undefined && (typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(model.trim()))) {
      return res.status(400).json({ ok: false, error: '模型名稱格式不正確。' });
    }
    try {
      this.service.updateAiSettings({ apiKey, model, clearApiKey: Boolean(clearApiKey) });
      this.repo.addAuditLog(req.authUser!.id, 'CHANGE_SETTINGS', 'settings', 'ai', { model, clearApiKey: Boolean(clearApiKey) });
      res.json({ ok: true, changedResource: { type: 'settings', key: 'ai', data: this.service.getAiConfig() }, minimalSummary: { action: 'ai_settings_updated' } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to update AI settings' });
    }
  };

  public runAiAgent = async (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt || prompt.length > 1200) return res.status(400).json({ ok: false, error: '請輸入 1 到 1200 字的問題。' });
    try {
      const result = await this.service.runAiAgent(prompt);
      this.service.recordAgentTask(req.authUser!.id, prompt, result, 'completed');
      res.json({ ok: true, ...result });
    } catch (e: any) {
      this.service.recordAgentTask(req.authUser!.id, prompt, { error: e.message }, 'failed');
      if (e.message === 'GEMINI_API_KEY_NOT_CONFIGURED') return res.status(400).json({ ok: false, error: '尚未設定 Google Gemini API Key，請先前往系統設定。' });
      res.status(502).json({ ok: false, error: e.name === 'AbortError' ? 'AI 回應逾時，請稍後再試。' : (e.message || 'AI Agent request failed') });
    }
  };

  public getAgentOperations = (_req: Request, res: Response) => {
    res.json({ ok: true, operations: this.service.getAgentOperations() });
  };

  public getAgentTaskHistory = (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit ?? 20);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
    res.json({ ok: true, history: this.service.getAgentTaskHistory(limit) });
  };

  public querySop = (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt || prompt.length > 600) return res.status(400).json({ ok: false, error: '請輸入 1 到 600 字的 SOP 問題。' });
    const result = this.service.querySop(prompt);
    this.service.recordAgentTask(req.authUser!.id, prompt, result, 'completed', 'sop_query');
    res.json({ ok: true, ...result });
  };

  public queryAuditLogs = (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt || prompt.length > 600) return res.status(400).json({ ok: false, error: '請輸入 1 到 600 字的 Audit 問題。' });
    const result = this.service.queryAuditLogs(prompt);
    this.service.recordAgentTask(req.authUser!.id, prompt, result, 'completed', 'audit_query');
    this.repo.addAuditLog(req.authUser!.id, 'QUERY_AUDIT_LOG', 'audit', undefined, { parsedQuery: result.query });
    res.json({ ok: true, ...result });
  };

  public compareIncidentPhotos = async (req: Request, res: Response) => {
    try {
      const beforePhotoId = String(req.body?.beforePhotoId || '');
      const afterPhotoId = String(req.body?.afterPhotoId || '');
      const result = await this.service.compareIncidentPhotos(beforePhotoId, afterPhotoId);
      if (!result.ok || !('review' in result)) return res.status(result.status || 400).json(result);
      this.service.recordAgentTask(req.authUser!.id, `Compare photos ${beforePhotoId} and ${afterPhotoId}`, { answer: { title: 'Photo comparison', insight: result.review.summary, recommendation: result.review.decision } }, 'completed', 'photo_comparison');
      this.repo.addAuditLog(req.authUser!.id, 'AI_PHOTO_COMPARE', 'photo', afterPhotoId, { beforePhotoId, decision: result.review.decision, confidence: result.review.confidence });
      res.json(result);
    } catch (e: any) {
      if (e.message === 'GEMINI_API_KEY_NOT_CONFIGURED') return res.status(400).json({ ok: false, error: '尚未設定 Google Gemini API Key，請先前往系統設定。' });
      res.status(502).json({ ok: false, error: e.name === 'AbortError' ? 'AI 回應逾時，請稍後再試。' : (e.message || 'Photo comparison failed') });
    }
  };

  public createDispatchDraft = (req: Request, res: Response) => {
    const result = this.service.createDispatchDraft(String(req.body?.incidentId || ''), req.authUser!.id);
    if (!result.ok) return res.status(result.status || 400).json(result);
    this.repo.addAuditLog(req.authUser!.id, 'CREATE_AGENT_DRAFT', 'incident', result.draft!.incidentId, { draftType: 'dispatch', draftId: result.draft!.id });
    res.json(result);
  };

  public createLineDraft = (req: Request, res: Response) => {
    const result = this.service.createLineDraft(String(req.body?.incidentId || ''), String(req.body?.style || 'standard'), req.authUser!.id);
    if (!result.ok) return res.status(result.status || 400).json(result);
    this.repo.addAuditLog(req.authUser!.id, 'CREATE_AGENT_DRAFT', 'incident', result.draft!.incidentId, { draftType: 'line', draftId: result.draft!.id });
    res.json(result);
  };

  public confirmAgentActionDraft = async (req: Request, res: Response) => {
    try {
      const result = await this.service.confirmAgentActionDraft(String(req.params.draftId || ''));
      if (!result.ok) return res.status(result.status || 400).json(result);
      this.repo.addAuditLog(req.authUser!.id, 'CONFIRM_AGENT_DRAFT', 'incident', result.incident!.id, { draftId: req.params.draftId, action: result.action });
      res.json({
        ok: true,
        changedResource: { type: 'incident', data: result.incident },
        minimalSummary: { action: result.action, draftId: req.params.draftId, queueStatus: result.queueStatus }
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to confirm draft' });
    }
  };

  public sendLineTest = async (req: Request, res: Response) => {
    try {
      const status = this.service.queueLineTest(String(req.body?.message || ''));
      this.repo.addAuditLog(req.authUser!.id, 'LINE_CONFIG_CHANGE', 'notification', 'line-test', {});
      res.json({ ok: true, status, changedResource: { type: 'notification', data: { status } }, minimalSummary: { action: 'line_test_queued', status } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to queue LINE test' });
    }
  };

  public receiveLineWebhook = async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const verification = this.service.verifyLineWebhook(rawBody, req.header('x-line-signature') || undefined);
    if (!verification.valid) {
      return res.status(verification.reason.includes('not configured') ? 503 : 401).json({ ok: false, error: verification.reason });
    }
    try {
      const body = JSON.parse(rawBody.toString('utf8'));
      const capturedTargets = this.service.captureLineWebhookTargets(body);
      if (capturedTargets > 0) this.repo.addAuditLog(null, 'LINE_CONFIG_CHANGE', 'webhook', undefined, { capturedCount: capturedTargets });
      res.json({ ok: true, capturedTargets });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message || 'Invalid LINE webhook payload' });
    }
  };

  public getUpload = (req: Request, res: Response) => {
    const filename = String(req.params.filename || '');
    if (!filename || path.basename(filename) !== filename) return res.status(404).json({ ok: false, error: 'File not found' });
    if (req.authUser!.role !== 'admin') {
      const photo = this.repo.getUploadedPhotoByPath(`uploads/${filename}`);
      if (!photo || photo.user_id !== req.authUser!.id) return res.status(404).json({ ok: false, error: 'File not found' });
    }
    res.sendFile(path.resolve(this.uploadDir, filename), error => {
      if (error && !res.headersSent) res.status(404).json({ ok: false, error: 'File not found' });
    });
  };

  public getAnnotatedDamagePhoto = async (req: Request, res: Response) => {
    try {
      const image = await this.service.getAnnotatedDamagePhoto(String(req.params.photoId || ''));
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, no-store');
      res.send(image);
    } catch (e: any) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to render annotated photo' });
    }
  };

  public getSignedLineDamagePhoto = async (req: Request, res: Response) => {
    const { verifySignedLineImage } = await import('../services/DamageAnnotations');
    const photoId = String(req.params.photoId || '');
    if (!verifySignedLineImage(photoId, req.query.expires, req.query.signature)) return res.status(404).end();
    try {
      const image = await this.service.getAnnotatedDamagePhoto(photoId);
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=60');
      res.send(image);
    } catch {
      res.status(404).end();
    }
  };
}
