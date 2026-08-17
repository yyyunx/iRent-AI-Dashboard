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

  public updateSlackSettings = async (req: Request, res: Response) => {
    const payload = req.body;
    const webhook = (payload.webhook || "").trim();
    if (!webhook.startsWith("https://hooks.slack.com/services/")) {
      return res.status(400).json({ ok: false, error: "Invalid webhook" });
    }
    try {
      this.repo.setSetting("slackWebhook", webhook);
      res.json({ ok: true, state: this.service.getProjectState() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message || "Failed to update slack webhook" });
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
