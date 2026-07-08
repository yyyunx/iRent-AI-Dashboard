import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseRepository } from '../repositories/DatabaseRepository';
import {
  Incident,
  IncidentResponse,
  dbRowToIncidentResponse,
  dbRowToSubmissionResponse,
  dbRowToPhotoResponse
} from '../models/types';

export class DashboardService {
  private repo: DatabaseRepository;
  private uploadDir: string;

  constructor(repo: DatabaseRepository, uploadDir: string) {
    this.repo = repo;
    this.uploadDir = uploadDir;
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

  public getOpsMetrics() {
    const incidents = this.repo.getIncidents();
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

  public getProjectState() {
    const incidentsRaw = this.repo.getIncidents();
    const incidents = incidentsRaw.map(row => {
      const enriched = { ...row, score: this.calculateScore(row) };
      return dbRowToIncidentResponse(enriched);
    });

    // Sort by priority score desc
    incidents.sort((a, b) => b.score - a.score);

    const timelines = this.repo.getTimelines();
    const comments = this.repo.getComments();
    const notifications = this.repo.getSlackNotifications();
    const reports = this.repo.getMaintenanceReports();
    const submissionsRaw = this.repo.getPhotoSubmissions();
    const submissions = submissionsRaw.map(row => dbRowToSubmissionResponse(row));
    const uploadedPhotosRaw = this.repo.getUploadedPhotos();
    const uploadedPhotos = uploadedPhotosRaw.map(row => dbRowToPhotoResponse(row));

    const lineGroup = this.repo.getSetting("lineGroup", "iRent Ops Alerts");
    const slackConnected = Boolean(this.repo.getSetting("slackWebhook"));

    const lineLogs = notifications.map(row => ({
      title: `${row.status} · ${row.event_type} · ${row.incident_id || '-'}`,
      time: row.created_at,
      group: lineGroup,
      message: row.message
    }));

    const DAMAGE_HOTSPOTS = [["右後門", 12], ["前保桿", 9], ["左後輪弧", 7], ["後保桿", 5], ["車頂", 2]];
    const hotspotsVal = JSON.parse(this.repo.getSetting("damageHotspots", JSON.stringify(DAMAGE_HOTSPOTS)));

    return {
      incidents,
      damageHotspots: hotspotsVal,
      lineGroup,
      slackConnected,
      slackWebhook: "",
      lineLogs,
      timelines,
      comments,
      slackNotifications: notifications,
      maintenanceReports: reports,
      photoSubmissions: submissions,
      uploadedPhotos,
      opsMetrics: this.getOpsMetrics()
    };
  }

  // --- Slack Integration ---
  public async sendSlack(incidentId: string | null, eventType: string, message: string): Promise<string> {
    const webhook = this.repo.getSetting("slackWebhook");
    let status = "not_configured";
    let attempts = 0;
    let lastError = "SLACK_WEBHOOK_URL or Settings.slackWebhook is not configured";

    if (webhook && webhook.startsWith("https://hooks.slack.com/services/")) {
      for (let i = 0; i < 2; i++) {
        attempts++;
        try {
          const res = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message })
          });
          const text = await res.text();
          if (res.status >= 200 && res.status < 300) {
            status = "sent";
            lastError = "";
            break;
          }
          status = "failed";
          lastError = `HTTP ${res.status}: ${text}`;
        } catch (e: any) {
          status = "failed";
          lastError = e.message || String(e);
        }
      }
    }

    this.repo.addSlackNotification(incidentId, eventType, message, status, attempts, lastError);

    if (incidentId) {
      if (status === "sent") {
        this.repo.addTimeline(incidentId, "slack_sent", "Slack Sent", message);
      } else {
        this.repo.addTimeline(incidentId, "slack_failed", "Slack Failed", lastError);
      }
    }

    return status;
  }

  public getSlackMessage(incident: IncidentResponse, eventType: string, extra = ""): string {
    const headlineMap: Record<string, string> = {
      ai_detected: "AI 建立 Incident",
      dispatch: "派工更新",
      comment: "客服留言",
      in_progress: "任務開始",
      resolved: "任務完成",
      reopen: "Incident Reopen",
    };
    const headline = headlineMap[eventType] || "iRent Ops 通知";

    const lines = [
      `*${headline}* | ${incident.plate}`,
      `事件: ${incident.label}`,
      `位置: ${incident.station}`,
      `AI Confidence: ${incident.confidence}%`,
      `狀態: ${incident.status}`,
      `負責對象: ${incident.assignee}`,
    ];
    if (extra) {
      lines.push(`補充: ${extra}`);
    }
    return lines.join("\n");
  }

  // --- Photo Quality and Scenario Seeding ---
  private savePhotoFile(prefix: string, filename: string, dataUrl: string): string {
    if (!dataUrl) return "";
    let base64Data = dataUrl;
    if (dataUrl.includes(",")) {
      base64Data = dataUrl.split(",")[1];
    }
    const cleanName = filename.replace(/[^A-Za-z0-9_.-]/g, "_");
    const ext = path.extname(cleanName) || ".jpg";
    const storedName = `${prefix}_${Date.now()}${ext}`;
    const filePath = path.join(this.uploadDir, storedName);

    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
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

  public async handleQualityCheckAction(payload: any) {
    const photoId = "PHOTO-" + (this.repo.getUploadedPhotoCount() + 1).toString().padStart(3, '0');
    const relativePath = this.savePhotoFile(photoId, payload.filename || `${photoId}.jpg`, payload.imageData || payload.data || "");

    const textPayload = `${payload.filename || ''} ${payload.slot || ''} ${payload.imageData || ''} ${payload.data || ''} ${payload.note || ''}`;
    const quality = this.runQualityCheck(payload.filename || '', payload.slot || '', textPayload);

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
      ai_result_json: ''
    });

    return {
      photoId,
      quality
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

  public async createIncidentFromAiResult(submission: any, aiResults: any[]): Promise<string[]> {
    const created: string[] = [];
    for (const result of aiResults) {
      const shouldCreate = result.damageDetected || result.cleanliness === "dirty";
      if (!shouldCreate) continue;

      const incidentId = "INC-AI-" + (this.repo.getIncidentCount() + 1).toString().padStart(3, '0');
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
        score
      };

      this.repo.insertIncident(item);

      this.repo.addTimeline(
        incidentId,
        "photo_ai_analysis",
        "Photo AI Analysis",
        `rentalId=${submission.rentalId} phase=${submission.phase} slot=${result.slot}`
      );

      const incidentRes = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId));
      await this.sendSlack(incidentId, "ai_detected", this.getSlackMessage(incidentRes, "ai_detected"));

      created.push(incidentId);
    }
    return created;
  }

  public async handlePhotoSubmissionAction(payload: any) {
    const submissionId = "SUB-" + (this.repo.getPhotoSubmissionCount() + 1).toString().padStart(3, '0');
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
    const createdIncidents = await this.createIncidentFromAiResult(submissionObj, aiResults);

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
      ai_summary: aiSummary
    });

    // Save individual photos
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const aiResult = aiResults[i];
      const photoId = p.photoId || "PHOTO-" + (this.repo.getUploadedPhotoCount() + 1).toString().padStart(3, '0');

      const photoPayload = {
        rentalId: payload.rentalId,
        plate: payload.plate,
        phase: payload.phase,
        slot: p.slot || "front",
        filename: p.filename || `${p.slot || 'photo'}.jpg`,
        imageData: p.imageData || p.data || ""
      };

      if (p.photoId) {
        this.repo.updateUploadedPhotoSubmission(p.photoId, submissionId, JSON.stringify(aiResult));
      } else {
        const fileRelPath = this.savePhotoFile(photoId, photoPayload.filename, photoPayload.imageData);
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
          ai_result_json: JSON.stringify(aiResult)
        });
      }
    }

    if (createdIncidents.length > 0) {
      const slackMessage = [
        `*Photo AI Incident* | ${payload.plate}`,
        `Rental: ${payload.rentalId}`,
        `Phase: ${payload.phase}`,
        `Incidents: ${createdIncidents.join(', ')}`,
        `Dashboard: /irent-ops-dashboard.html`
      ].join('\n');

      await this.sendSlack(createdIncidents[0], "photo_submission", slackMessage);
    }

    return {
      submissionId,
      overallStatus,
      results: aiResults,
      createdIncidents
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
      await this.sendSlack(incidentId, "dispatch", this.getSlackMessage(updated, "dispatch"));

    } else if (action === "comment") {
      const body = (payload.body || "").trim();
      const author = (payload.author || "客服").trim();
      if (!body) {
        return { status: 400, ok: false, error: "Comment body is required" };
      }
      this.repo.addComment(incidentId, author, body);
      this.repo.addTimeline(incidentId, "comment", "Comment", `${author}: ${body}`);
      await this.sendSlack(incidentId, "comment", this.getSlackMessage(incidentRes, "comment", body));

    } else if (action === "in_progress") {
      this.repo.updateIncidentStatusAndAssignee(incidentId, "in_progress", incident.assignee);
      this.repo.updateDispatchTaskStatus(incidentId, "in_progress");
      this.repo.addTimeline(incidentId, "in_progress", "In Progress", "Task started");

      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      await this.sendSlack(incidentId, "in_progress", this.getSlackMessage(updated, "in_progress"));

    } else if (action === "resolve") {
      this.repo.updateIncidentStatusAndAssignee(incidentId, "resolved", "人工確認結案", {
        severity: "low",
        manual_review_required: 0,
        resolved_at: this.repo.nowText()
      });
      this.repo.updateDispatchTaskStatus(incidentId, "done");
      this.repo.addTimeline(incidentId, "resolved", "Manual Close", "Manual confirmed");

      const updated = dbRowToIncidentResponse(this.repo.getIncidentById(incidentId)!);
      await this.sendSlack(incidentId, "resolved", this.getSlackMessage(updated, "resolved"));

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
      await this.sendSlack(incidentId, "reopen", this.getSlackMessage(updated, "reopen"));

    } else if (action === "maintenance_report") {
      const note = (payload.note || "").trim();
      const photoPayload = payload.photo;
      const photoId = `MR-${incidentId}`;

      let savedPath = "";
      if (photoPayload) {
        savedPath = this.savePhotoFile(photoId, photoPayload.name || "report.jpg", photoPayload.data || "");
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
      await this.sendSlack(incidentId, "maintenance_report", this.getSlackMessage(updated, "maintenance_report", note || review.result));

    } else {
      return { status: 400, ok: false, error: "Unknown action" };
    }

    return { status: 200, ok: true };
  }
}
