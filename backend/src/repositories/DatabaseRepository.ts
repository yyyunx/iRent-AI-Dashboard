import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  Incident,
  IncidentTimeline,
  DispatchTask,
  Comment,
  Settings,
  MaintenanceReport,
  PhotoSubmission,
  UploadedPhoto
} from '../models/types';

const SEED_INCIDENTS = [
  { id: "INC-302", plate: "ABC-1234", station: "台北101站", type: "damage", label: "新增右後門刮傷", severity: "high", confidence: 96, time: "08:32", nextBooking: 28, hotStation: true, x: 69, y: 24, assignee: "待客服確認", status: "todo", score: 0 },
  { id: "INC-303", plate: "XYZ-8888", station: "中山站", type: "cleaning", label: "車內後座垃圾", severity: "high", confidence: 91, time: "08:36", nextBooking: 18, hotStation: true, x: 43, y: 39, assignee: "王先生 600m", status: "assigned", score: 0 },
  { id: "INC-304", plate: "KKB-5200", station: "松山機場", type: "cleaning", label: "飲料杯與地墊髒污", severity: "medium", confidence: 88, time: "08:41", nextBooking: 52, hotStation: true, x: 76, y: 57, assignee: "林小姐 1.1km", status: "assigned", score: 0 },
  { id: "INC-305", plate: "RNT-7788", station: "台北車站", type: "damage", label: "疑似保桿擦傷", severity: "medium", confidence: 83, time: "08:47", nextBooking: 74, hotStation: true, x: 31, y: 26, assignee: "待客服確認", status: "todo", score: 0 },
  { id: "INC-306", plate: "QAZ-2468", station: "士林站", type: "normal", label: "照片通過檢查", severity: "low", confidence: 94, time: "08:52", nextBooking: 140, hotStation: false, x: 22, y: 63, assignee: "無需處理", status: "done", score: 0 },
  { id: "INC-307", plate: "TPE-1688", station: "信義安和站", type: "cleaning", label: "一般灰塵", severity: "low", confidence: 79, time: "08:58", nextBooking: 126, hotStation: false, x: 58, y: 72, assignee: "排入例行清潔", status: "todo", score: 0 },
];

const DAMAGE_HOTSPOTS = [["右後門", 12], ["前保桿", 9], ["左後輪弧", 7], ["後保桿", 5], ["車頂", 2]];

const REGION_TEAMS: [string, string, string[]][] = [
  ["北區小隊", "北區", ["台北", "臺北", "新北", "基隆", "板橋", "中山", "士林", "信義"]],
  ["桃竹苗小隊", "桃竹苗", ["桃園", "新竹", "苗栗"]],
  ["中區小隊", "中區", ["台中", "臺中", "彰化", "南投"]],
  ["南區小隊", "南區", ["台南", "臺南", "高雄", "屏東"]],
  ["東區小隊", "東區", ["宜蘭", "花蓮", "台東", "臺東"]],
];

export class DatabaseRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.initDb();
  }

  private initDb() {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS Incident (
        id TEXT PRIMARY KEY,
        plate TEXT NOT NULL,
        station TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        detected_time TEXT NOT NULL,
        next_booking INTEGER NOT NULL,
        hot_station INTEGER NOT NULL DEFAULT 0,
        map_x REAL NOT NULL,
        map_y REAL NOT NULL,
        assignee TEXT NOT NULL,
        status TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        region TEXT DEFAULT '',
        assigned_team TEXT DEFAULT '',
        auto_closed INTEGER NOT NULL DEFAULT 0,
        ai_review_confidence INTEGER,
        ai_review_result TEXT,
        ai_review_summary TEXT,
        manual_review_required INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS IncidentTimeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES Incident(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS DispatchTask (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        assignee TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES Incident(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS Comment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES Incident(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS SlackNotification (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES Incident(id) ON DELETE SET NULL
      );

      -- Kept separately from SlackNotification so existing audit data remains intact.
      CREATE TABLE IF NOT EXISTS NotificationLog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        incident_id TEXT,
        event_type TEXT NOT NULL,
        target_id TEXT,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES Incident(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_log_status ON NotificationLog(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS Settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS MaintenanceReport (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        photo_path TEXT,
        result TEXT NOT NULL,
        note TEXT,
        ai_review_result TEXT,
        ai_review_confidence INTEGER,
        ai_review_summary TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES Incident(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS PhotoSubmission (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id TEXT UNIQUE NOT NULL,
        rental_id TEXT NOT NULL,
        plate TEXT NOT NULL,
        phase TEXT NOT NULL,
        station TEXT,
        parking_location TEXT,
        status TEXT NOT NULL,
        overall_status TEXT NOT NULL,
        ai_summary TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS UploadedPhoto (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_id TEXT UNIQUE NOT NULL,
        submission_id TEXT,
        rental_id TEXT NOT NULL,
        plate TEXT NOT NULL,
        phase TEXT NOT NULL,
        slot TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT,
        quality_passed INTEGER NOT NULL DEFAULT 0,
        blur_score REAL,
        is_blur INTEGER NOT NULL DEFAULT 0,
        plate_visible INTEGER NOT NULL DEFAULT 1,
        angle_valid INTEGER NOT NULL DEFAULT 1,
        distance_valid INTEGER NOT NULL DEFAULT 1,
        ai_result_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (submission_id) REFERENCES PhotoSubmission(submission_id) ON DELETE SET NULL
      );
    `);

    this.migrateDb();

    // Seed defaults
    const now = this.nowText();
    this.db.prepare("INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)").run("lineGroup", "iRent Ops Alerts", now);
    this.db.prepare("INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)").run("lineTargetId", "", now);
    this.db.prepare("INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)").run("lineNotificationEnabled", "true", now);
    this.db.prepare("INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)").run("damageHotspots", JSON.stringify(DAMAGE_HOTSPOTS), now);

    const incidentCount = (this.db.prepare("SELECT COUNT(*) as count FROM Incident").get() as any).count;
    if (incidentCount === 0) {
      for (const item of SEED_INCIDENTS) {
        this.insertIncidentSeed(item);
      }
    }

    // Auto assign teams/regions if they are empty
    const unassigned = this.db.prepare("SELECT id, station, assignee FROM Incident WHERE assigned_team = '' OR region = ''").all() as any[];
    for (const row of unassigned) {
      const [team, region] = this.assignTeam(row.station);
      const assigneeVal = (row.assignee === '待客服確認' || row.assignee === '無需處理') ? row.assignee : team;
      this.db.prepare("UPDATE Incident SET assigned_team = ?, region = ?, assignee = ? WHERE id = ?").run(team, region, assigneeVal, row.id);
    }
  }

  private migrateDb() {
    // Add columns dynamically to match Python's migrate_db
    const incidentColumns = this.db.prepare("PRAGMA table_info(Incident)").all() as any[];
    const existingIncidentCols = new Set(incidentColumns.map(c => c.name));

    const migrations: Record<string, string> = {
      region: "TEXT DEFAULT ''",
      assigned_team: "TEXT DEFAULT ''",
      auto_closed: "INTEGER NOT NULL DEFAULT 0",
      ai_review_confidence: "INTEGER",
      ai_review_result: "TEXT",
      ai_review_summary: "TEXT",
      manual_review_required: "INTEGER NOT NULL DEFAULT 0",
      resolved_at: "TEXT"
    };

    for (const [col, def] of Object.entries(migrations)) {
      if (!existingIncidentCols.has(col)) {
        this.db.exec(`ALTER TABLE Incident ADD COLUMN ${col} ${def}`);
      }
    }

    const reportColumns = this.db.prepare("PRAGMA table_info(MaintenanceReport)").all() as any[];
    const existingReportCols = new Set(reportColumns.map(c => c.name));
    if (!existingReportCols.has("ai_review_summary")) {
      this.db.exec("ALTER TABLE MaintenanceReport ADD COLUMN ai_review_summary TEXT");
    }
  }

  public nowText(): string {
    const d = new Date();
    // Format: YYYY-MM-DD HH:MM:SS in local time
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  public assignTeam(station: string): [string, string] {
    for (const [team, region, keywords] of REGION_TEAMS) {
      if (keywords.some(keyword => station.includes(keyword))) {
        return [team, region];
      }
    }
    return ["北區小隊", "北區"];
  }

  private insertIncidentSeed(item: any) {
    const ts = this.nowText();
    const [team, region] = this.assignTeam(item.station);
    const status = item.type !== 'normal' ? 'assigned' : (item.status || 'done');
    const assignee = item.type !== 'normal' ? team : '無需處理';

    this.db.prepare(`
      INSERT OR REPLACE INTO Incident(
        id, plate, station, type, label, severity, confidence, detected_time,
        next_booking, hot_station, map_x, map_y, assignee, status, score,
        region, assigned_team, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id, item.plate, item.station, item.type, item.label, item.severity,
      item.confidence, item.time || new Date().toLocaleTimeString('zh-TW', { hour12: false }).substring(0, 5),
      item.nextBooking, item.hotStation ? 1 : 0, item.x, item.y, assignee,
      status, item.score || 0, region, team, ts, ts
    );

    // Initial timeline
    this.addTimeline(item.id, "ai_detected", "AI Detected", `${item.label} | Confidence ${item.confidence}%`);
    if (item.type !== 'normal') {
      this.addTimeline(item.id, "assigned", "Auto Assigned", `${region} | ${team}`);
    }

    // Initial dispatch task
    const taskType = item.type === "damage" ? "Inspection" : item.type === "cleaning" ? "Cleaning" : "Release";
    this.db.prepare(`
      INSERT INTO DispatchTask(incident_id, task_type, assignee, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(item.id, taskType, assignee, status, ts, ts);
  }

  // --- Read operations ---
  public getIncidents(): Incident[] {
    return this.db.prepare("SELECT * FROM Incident ORDER BY created_at DESC, id DESC").all() as Incident[];
  }

  public getIncidentById(id: string): Incident | null {
    const row = this.db.prepare("SELECT * FROM Incident WHERE id = ?").get(id);
    return row ? (row as Incident) : null;
  }

  public getTimelines(): Record<string, IncidentTimeline[]> {
    const list = this.db.prepare("SELECT * FROM IncidentTimeline ORDER BY id ASC").all() as IncidentTimeline[];
    const map: Record<string, IncidentTimeline[]> = {};
    for (const row of list) {
      if (!map[row.incident_id]) {
        map[row.incident_id] = [];
      }
      map[row.incident_id].push(row);
    }
    return map;
  }

  public getComments(): Record<string, Comment[]> {
    const list = this.db.prepare("SELECT * FROM Comment ORDER BY id ASC").all() as Comment[];
    const map: Record<string, Comment[]> = {};
    for (const row of list) {
      if (!map[row.incident_id]) {
        map[row.incident_id] = [];
      }
      map[row.incident_id].push(row);
    }
    return map;
  }

  public getMaintenanceReports(): Record<string, MaintenanceReport[]> {
    const list = this.db.prepare("SELECT * FROM MaintenanceReport ORDER BY id ASC").all() as MaintenanceReport[];
    const map: Record<string, MaintenanceReport[]> = {};
    for (const row of list) {
      if (!map[row.incident_id]) {
        map[row.incident_id] = [];
      }
      map[row.incident_id].push(row);
    }
    return map;
  }

  public getPhotoSubmissions(limit = 50): PhotoSubmission[] {
    return this.db.prepare("SELECT * FROM PhotoSubmission ORDER BY id DESC LIMIT ?").all(limit) as PhotoSubmission[];
  }

  public getAllPhotoSubmissions(): PhotoSubmission[] {
    return this.db.prepare("SELECT * FROM PhotoSubmission ORDER BY id DESC").all() as PhotoSubmission[];
  }

  public getPhotoSubmissionDetail(submissionId: string): PhotoSubmission | null {
    const row = this.db.prepare("SELECT * FROM PhotoSubmission WHERE submission_id = ?").get(submissionId);
    return row ? (row as PhotoSubmission) : null;
  }

  public getUploadedPhotosBySubmission(submissionId: string): UploadedPhoto[] {
    return this.db.prepare("SELECT * FROM UploadedPhoto WHERE submission_id = ? ORDER BY id ASC").all(submissionId) as UploadedPhoto[];
  }

  public getUploadedPhotos(limit = 100): UploadedPhoto[] {
    return this.db.prepare("SELECT * FROM UploadedPhoto ORDER BY id DESC LIMIT ?").all(limit) as UploadedPhoto[];
  }

  // --- Write Operations ---
  public addTimeline(incidentId: string, eventType: string, title: string, body = '') {
    this.db.prepare(`
      INSERT INTO IncidentTimeline(incident_id, event_type, title, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(incidentId, eventType, title, body, this.nowText());
  }

  public insertIncident(item: Partial<Incident>) {
    const ts = this.nowText();
    const [team, region] = this.assignTeam(item.station || '');
    const status = item.type !== 'normal' ? 'assigned' : (item.status || 'done');
    const assignee = item.type !== 'normal' ? team : '無需處理';

    this.db.prepare(`
      INSERT OR REPLACE INTO Incident(
        id, plate, station, type, label, severity, confidence, detected_time,
        next_booking, hot_station, map_x, map_y, assignee, status, score,
        region, assigned_team, manual_review_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      item.id, item.plate, item.station, item.type, item.label, item.severity,
      item.confidence, item.detected_time || new Date().toLocaleTimeString('zh-TW', { hour12: false }).substring(0, 5),
      item.next_booking ?? 24, item.hot_station ?? 0, item.map_x ?? 50.0, item.map_y ?? 50.0, assignee,
      status, item.score ?? 0, region, team, ts, ts
    );

    this.addTimeline(item.id!, "ai_detected", "AI Detected", `${item.label} | Confidence ${item.confidence}%`);
    if (item.type !== 'normal') {
      this.addTimeline(item.id!, "assigned", "Auto Assigned", `${region} | ${team}`);
    }

    const taskType = item.type === "damage" ? "Inspection" : item.type === "cleaning" ? "Cleaning" : "Release";
    this.db.prepare(`
      INSERT INTO DispatchTask(incident_id, task_type, assignee, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(item.id, taskType, assignee, status, ts, ts);
  }

  public updateIncidentStatusAndAssignee(incidentId: string, status: string, assignee: string, extraFields: Record<string, any> = {}) {
    const ts = this.nowText();
    const setClause = ['status = ?', 'assignee = ?', 'updated_at = ?'];
    const params = [status, assignee, ts];

    for (const [key, val] of Object.entries(extraFields)) {
      setClause.push(`${key} = ?`);
      params.push(val);
    }
    params.push(incidentId);

    this.db.prepare(`
      UPDATE Incident SET ${setClause.join(', ')} WHERE id = ?
    `).run(...params);
  }

  public updateDispatchTaskStatus(incidentId: string, status: string, assignee?: string) {
    const ts = this.nowText();
    if (assignee) {
      this.db.prepare(`
        UPDATE DispatchTask SET status = ?, assignee = ?, updated_at = ? WHERE incident_id = ?
      `).run(status, assignee, ts, incidentId);
    } else {
      this.db.prepare(`
        UPDATE DispatchTask SET status = ?, updated_at = ? WHERE incident_id = ?
      `).run(status, ts, incidentId);
    }
  }

  public addComment(incidentId: string, author: string, body: string) {
    this.db.prepare(`
      INSERT INTO Comment(incident_id, author, body, created_at)
      VALUES (?, ?, ?, ?)
    `).run(incidentId, author, body, this.nowText());
  }

  public addNotification(notification: {
    provider: 'line'; incidentId: string | null; eventType: string; targetId?: string | null;
    message: string; status: string; attempts?: number; error?: string | null;
  }): number {
    const ts = this.nowText();
    const result = this.db.prepare(`
      INSERT INTO NotificationLog(provider, incident_id, event_type, target_id, message, status, attempts, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      notification.provider, notification.incidentId, notification.eventType, notification.targetId || null,
      notification.message, notification.status, notification.attempts || 0, notification.error || null, ts, ts
    );
    return Number(result.lastInsertRowid);
  }

  public updateNotification(id: number, status: string, attempts: number, error: string | null = null) {
    this.db.prepare(`
      UPDATE NotificationLog SET status = ?, attempts = ?, error = ?, updated_at = ? WHERE id = ?
    `).run(status, attempts, error, this.nowText(), id);
  }

  public getNotifications(limit = 100) {
    return this.db.prepare("SELECT * FROM NotificationLog ORDER BY id DESC LIMIT ?").all(limit) as any[];
  }

  public getPendingNotifications(limit = 50) {
    return this.db.prepare(`
      SELECT * FROM NotificationLog WHERE provider = 'line' AND status = 'queued' ORDER BY id ASC LIMIT ?
    `).all(limit) as any[];
  }

  public getNotificationStats() {
    return this.db.prepare(`
      SELECT provider, status, COUNT(*) AS count
      FROM NotificationLog
      GROUP BY provider, status
    `).all() as { provider: string; status: string; count: number }[];
  }

  public getSetting(key: string, defaultValue = ''): string {
    const row = this.db.prepare("SELECT value FROM Settings WHERE key = ?").get(key) as any;
    return row ? row.value : defaultValue;
  }

  public setSetting(key: string, value: string) {
    const ts = this.nowText();
    this.db.prepare(`
      INSERT INTO Settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, ts);
  }

  public insertMaintenanceReport(report: Partial<MaintenanceReport>) {
    const ts = this.nowText();
    this.db.prepare(`
      INSERT INTO MaintenanceReport(incident_id, photo_path, result, note, ai_review_result, ai_review_confidence, ai_review_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.incident_id, report.photo_path || null, report.result, report.note || null,
      report.ai_review_result || null, report.ai_review_confidence || null, report.ai_review_summary || null, ts
    );
  }

  public getIncidentCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM Incident").get() as any;
    return row ? row.count : 0;
  }

  public getUploadedPhotoCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM UploadedPhoto").get() as any;
    return row ? row.count : 0;
  }

  public getPhotoSubmissionCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM PhotoSubmission").get() as any;
    return row ? row.count : 0;
  }

  public insertPhotoSubmission(sub: Partial<PhotoSubmission>) {
    this.db.prepare(`
      INSERT INTO PhotoSubmission(submission_id, rental_id, plate, phase, station, parking_location, status, overall_status, ai_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sub.submission_id, sub.rental_id, sub.plate, sub.phase, sub.station || null,
      sub.parking_location || null, sub.status, sub.overall_status, sub.ai_summary || null, this.nowText()
    );
  }

  public insertUploadedPhoto(photo: Partial<UploadedPhoto>) {
    const ts = this.nowText();
    this.db.prepare(`
      INSERT OR REPLACE INTO UploadedPhoto(
        photo_id, submission_id, rental_id, plate, phase, slot, filename, file_path,
        quality_passed, blur_score, is_blur, plate_visible, angle_valid, distance_valid,
        ai_result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      photo.photo_id,
      photo.submission_id || null,
      photo.rental_id,
      photo.plate,
      photo.phase,
      photo.slot,
      photo.filename,
      photo.file_path || null,
      photo.quality_passed ? 1 : 0,
      photo.blur_score ?? null,
      photo.is_blur ? 1 : 0,
      photo.plate_visible ? 1 : 0,
      photo.angle_valid ? 1 : 0,
      photo.distance_valid ? 1 : 0,
      photo.ai_result_json || '',
      ts
    );
  }

  public updateUploadedPhotoSubmission(photoId: string, submissionId: string, aiResultJson: string) {
    this.db.prepare(`
      UPDATE UploadedPhoto SET submission_id = ?, ai_result_json = ? WHERE photo_id = ?
    `).run(submissionId, aiResultJson, photoId);
  }

  public getMaintenanceReportCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM MaintenanceReport").get() as any;
    return row ? row.count : 0;
  }
}
