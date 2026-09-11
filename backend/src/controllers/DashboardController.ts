import { Request, Response } from 'express';
import { DatabaseRepository } from '../repositories/DatabaseRepository';
import { DashboardService } from '../services/DashboardService';
import { dbRowToSubmissionResponse, dbRowToPhotoResponse } from '../models/types';

export class DashboardController {
  private repo: DatabaseRepository;
  private service: DashboardService;

  constructor(repo: DatabaseRepository, service: DashboardService) {
    this.repo = repo;
    this.service = service;
  }

  public getProjectState = async (req: Request, res: Response) => {
    try {
      const state = this.service.getProjectState();
      res.json(state);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || "Failed to get state" });
    }
  };

  public getPhotoSubmissions = async (req: Request, res: Response) => {
    try {
      const submissionsRaw = this.repo.getAllPhotoSubmissions();
      const submissions = submissionsRaw.map(row => dbRowToSubmissionResponse(row));
      res.json({ ok: true, submissions });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || "Failed to get submissions" });
    }
  };

  public getPhotoSubmissionDetail = async (req: Request, res: Response) => {
    const submissionId = req.params.submissionId;
    try {
      const detailRaw = this.repo.getPhotoSubmissionDetail(submissionId);
      if (!detailRaw) {
        return res.status(404).json({ ok: false, error: "Submission not found" });
      }
      const photosRaw = this.repo.getUploadedPhotosBySubmission(submissionId);
      const photos = photosRaw.map(row => dbRowToPhotoResponse(row));

      const detail = dbRowToSubmissionResponse(detailRaw);
      res.json({
        ok: true,
        submission: {
          ...detail,
          photos
        }
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || "Failed to get submission details" });
    }
  };

  public insertIncident = async (req: Request, res: Response) => {
    const payload = req.body;
    try {
      // Map payload keys back to DB column keys if needed, but repo.insertIncident accepts partial Incident
      const dbItem = {
        id: payload.id,
        plate: payload.plate,
        station: payload.station,
        type: payload.type,
        label: payload.label,
        severity: payload.severity,
        confidence: Number(payload.confidence),
        detected_time: payload.time,
        next_booking: Number(payload.nextBooking ?? payload.next_booking ?? 24),
        hot_station: payload.hotStation ? 1 : 0,
        map_x: Number(payload.x ?? payload.map_x),
        map_y: Number(payload.y ?? payload.map_y),
        status: payload.status || 'todo',
        score: Number(payload.score || 0)
      };

      this.repo.insertIncident(dbItem);
      res.json({ ok: true, state: this.service.getProjectState() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || "Failed to insert incident" });
    }
  };

  public handleAction = async (req: Request, res: Response) => {
    const payload = req.body;
    try {
      const result = await this.service.handleAction(payload);
      if (result.ok) {
        res.json({ ok: true, state: this.service.getProjectState() });
      } else {
        res.status(result.status || 400).json({ ok: false, error: result.error });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || "Failed to handle action" });
    }
  };

  public runQualityCheck = async (req: Request, res: Response) => {
    const payload = req.body;
    try {
      const result = await this.service.handleQualityCheckAction(payload);
      res.json({
        ok: true,
        photoId: result.photoId,
        quality: result.quality,
        state: this.service.getProjectState()
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || "Failed to run quality check" });
    }
  };

  public handlePhotoSubmission = async (req: Request, res: Response) => {
    const payload = req.body;
    try {
      const result = await this.service.handlePhotoSubmissionAction(payload);
      res.json({
        ok: true,
        submissionId: result.submissionId,
        overallStatus: result.overallStatus,
        results: result.results,
        createdIncidents: result.createdIncidents,
        state: this.service.getProjectState()
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || "Failed to handle photo submission" });
    }
  };

  public updateLineSettings = async (req: Request, res: Response) => {
    const { targetId, groupName, enabled } = req.body || {};
    if (targetId !== undefined && targetId !== '' && !/^[URC][A-Za-z0-9_-]{10,}$/.test(String(targetId))) {
      return res.status(400).json({ ok: false, error: 'LINE target ID must be a user, group, or room ID from a webhook event.' });
    }
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled must be true or false.' });
    }
    try {
      this.service.updateLineSettings({
        targetId: targetId === undefined ? undefined : String(targetId),
        groupName: groupName === undefined ? undefined : String(groupName),
        enabled
      });
      res.json({ ok: true, state: this.service.getProjectState() });
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
      res.json({ ok: true, state: this.service.getProjectState() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to update AI settings' });
    }
  };

  public runAiAgent = async (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt || prompt.length > 1200) return res.status(400).json({ ok: false, error: '請輸入 1 到 1200 字的問題。' });
    try {
      const result = await this.service.runAiAgent(prompt);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      if (e.message === 'OPENAI_API_KEY_NOT_CONFIGURED') {
        return res.status(400).json({ ok: false, error: '尚未設定 OpenAI API Key，請先前往系統設定。' });
      }
      const message = e.name === 'AbortError' ? 'AI 回應逾時，請稍後再試。' : (e.message || 'AI Agent request failed');
      res.status(502).json({ ok: false, error: message });
    }
  };

  public sendLineTest = async (req: Request, res: Response) => {
    try {
      const status = this.service.queueLineTest(String(req.body?.message || ''));
      res.json({ ok: true, status, state: this.service.getProjectState() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || 'Failed to queue LINE test' });
    }
  };

  /** Raw-body endpoint is registered before JSON parsing in app.ts for signature verification. */
  public receiveLineWebhook = async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const verification = this.service.verifyLineWebhook(rawBody, req.header('x-line-signature') || undefined);
    if (!verification.valid) {
      const status = verification.reason.includes('not configured') ? 503 : 401;
      return res.status(status).json({ ok: false, error: verification.reason });
    }
    try {
      const body = JSON.parse(rawBody.toString('utf8'));
      const capturedTargets = this.service.captureLineWebhookTargets(body);
      res.json({ ok: true, capturedTargets });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message || 'Invalid LINE webhook payload' });
    }
  };
}
