import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import {
  Incident,
  IncidentMapRow,
  IncidentTimeline,
  DispatchTask,
  Comment,
  Settings,
  MaintenanceReport,
  PhotoSubmission,
  UploadedPhoto,
  AuthSessionRecord,
  UserAccount,
  UserRole
} from '../models/types';

const SEED_INCIDENTS = [
  { id: "INC-302", plate: "ABC-1234", station: "台北101站", type: "damage", label: "新增右後門刮傷", severity: "high", confidence: 96, time: "08:32", nextBooking: 28, hotStation: true, x: 69, y: 24, assignee: "待客服確認", status: "todo", score: 0 },
  { id: "INC-303", plate: "XYZ-8888", station: "中山站", type: "cleaning", label: "車內後座垃圾", severity: "high", confidence: 91, time: "08:36", nextBooking: 18, hotStation: true, x: 43, y: 39, assignee: "王先生 600m", status: "assigned", score: 0 },
  { id: "INC-304", plate: "KKB-5200", station: "松山機場", type: "cleaning", label: "飲料杯與地墊髒污", severity: "medium", confidence: 88, time: "08:41", nextBooking: 52, hotStation: true, x: 76, y: 57, assignee: "林小姐 1.1km", status: "assigned", score: 0 },
  { id: "INC-305", plate: "RNT-7788", station: "台北車站", type: "damage", label: "疑似保桿擦傷", severity: "medium", confidence: 83, time: "08:47", nextBooking: 74, hotStation: true, x: 31, y: 26, assignee: "待客服確認", status: "todo", score: 0 },
  { id: "INC-306", plate: "QAZ-2468", station: "士林站", type: "normal", label: "照片通過檢查", severity: "low", confidence: 94, time: "08:52", nextBooking: 140, hotStation: false, x: 22, y: 63, assignee: "無需處理", status: "done", score: 0 },
  { id: "INC-307", plate: "TPE-1688", station: "信義安和站", type: "cleaning", label: "一般灰塵", severity: "low", confidence: 79, time: "08:58", nextBooking: 126, hotStation: false, x: 58, y: 72, assignee: "排入例行清潔", status: "todo", score: 0 },
];

export const DEFAULT_DAMAGE_HOTSPOTS = [["右後門", 12], ["前保桿", 9], ["左後輪弧", 7], ["後保桿", 5], ["車頂", 2]];

const REGION_TEAMS: [string, string, string[]][] = [
  ["北區小隊", "北區", ["台北", "臺北", "新北", "基隆", "板橋", "中山", "士林", "信義"]],
  ["桃竹苗小隊", "桃竹苗", ["桃園", "新竹", "苗栗"]],
  ["中區小隊", "中區", ["台中", "臺中", "彰化", "南投"]],
  ["南區小隊", "南區", ["台南", "臺南", "高雄", "屏東"]],
  ["東區小隊", "東區", ["宜蘭", "花蓮", "台東", "臺東"]],
];

export class DatabaseRepository {
  private db: Database.Database;
  private userHasLegacyEmailColumn = false;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    // This deployment uses a single backend instance. WAL allows readers to proceed while
    // a short write is in progress; busy_timeout turns transient SQLite contention into a wait
    // rather than an immediate "database is locked" response.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.migrateOperatorRole();
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
        owner_user_id INTEGER,
        source_submission_id TEXT,
        latitude REAL,
        longitude REAL,
        gps_accuracy REAL,
        address TEXT,
        parking_facility TEXT,
        floor TEXT,
        zone TEXT,
        pillar TEXT,
        parking_slot TEXT,
        location_note TEXT,
        operational_urgency TEXT,
        sla_minutes INTEGER,
        vehicle_unavailable INTEGER NOT NULL DEFAULT 0,
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
        coverage_summary_json TEXT,
        damage_summary_json TEXT,
        user_id INTEGER,
        latitude REAL,
        longitude REAL,
        gps_accuracy REAL,
        gps_captured_at TEXT,
        address TEXT,
        parking_facility TEXT,
        floor TEXT,
        zone TEXT,
        pillar TEXT,
        parking_slot TEXT,
        location_note TEXT,
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
        blur_threshold REAL,
        blur_checked_at TEXT,
        is_blur INTEGER NOT NULL DEFAULT 0,
        plate_visible INTEGER NOT NULL DEFAULT 1,
        angle_valid INTEGER NOT NULL DEFAULT 1,
        distance_valid INTEGER NOT NULL DEFAULT 1,
        ai_result_json TEXT,
        orientation_angle INTEGER,
        orientation_label TEXT,
        orientation_confidence REAL,
        orientation_passed INTEGER,
        orientation_checked_at TEXT,
        damage_detected INTEGER,
        damage_type TEXT,
        damage_confidence REAL,
        dirty_detected INTEGER,
        dirty_confidence REAL,
        condition_checked_at TEXT,
        user_id INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (submission_id) REFERENCES PhotoSubmission(submission_id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS User (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'operator', 'admin')),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS AuthSession (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_auth_session_user ON AuthSession(user_id, revoked_at, expires_at);

      CREATE TABLE IF NOT EXISTS AuditLog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        timestamp TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON AuditLog(user_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS AgentTaskHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        task_type TEXT NOT NULL,
        prompt_summary TEXT NOT NULL,
        result_summary TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL CHECK(status IN ('completed', 'failed')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_task_history_time ON AgentTaskHistory(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_task_history_user ON AgentTaskHistory(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS AgentActionDraft (
        id TEXT PRIMARY KEY,
        draft_type TEXT NOT NULL CHECK(draft_type IN ('dispatch', 'line')),
        incident_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_by INTEGER,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'confirmed', 'failed', 'expired')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        FOREIGN KEY (incident_id) REFERENCES Incident(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES User(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_action_draft_status ON AgentActionDraft(status, expires_at);

      CREATE TABLE IF NOT EXISTS VehicleAvailability (
        plate TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('AVAILABLE', 'UNAVAILABLE')),
        reason_incident_id TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (reason_incident_id) REFERENCES Incident(id) ON DELETE SET NULL
      );
    `);

    this.migrateDb();

    // Seed defaults
    const now = this.nowText();
    this.db.prepare("INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)").run("lineGroup", "iRent Ops Alerts", now);
    this.db.prepare("INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)").run("lineTargetId", "", now);
    this.db.prepare("INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)").run("lineNotificationEnabled", "true", now);
    this.db.prepare("INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)").run("damageHotspots", JSON.stringify(DEFAULT_DAMAGE_HOTSPOTS), now);

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
    this.db.exec(`CREATE TABLE IF NOT EXISTS StageMetric (
      id INTEGER PRIMARY KEY AUTOINCREMENT, stage TEXT NOT NULL, trace_id TEXT,
      started_at_ms REAL NOT NULL, duration_ms REAL NOT NULL, outcome TEXT NOT NULL,
      created_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_stage_metric_trace ON StageMetric(trace_id, stage);`);
    this.addColumnIfMissing('NotificationLog', 'payload_json', 'TEXT');
    this.addColumnIfMissing('NotificationLog', 'retry_key', 'TEXT');
    this.db.exec(`CREATE TABLE IF NOT EXISTS IncidentEscalation (
      incident_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
      FOREIGN KEY (incident_id) REFERENCES Incident(id) ON DELETE CASCADE
    );`);
    // Add columns dynamically to match Python's migrate_db
    const incidentColumns = this.db.prepare("PRAGMA table_info(Incident)").all() as any[];
    const existingIncidentCols = new Set(incidentColumns.map(c => c.name));

    const migrations: Record<string, string> = {
      region: "TEXT DEFAULT ''",
      assigned_team: "TEXT DEFAULT ''",
      assigned_user_id: "INTEGER",
      issue_count: "INTEGER NOT NULL DEFAULT 0",
      urgency_score: "INTEGER",
      urgency_breakdown_json: "TEXT",
      auto_closed: "INTEGER NOT NULL DEFAULT 0",
      ai_review_confidence: "INTEGER",
      ai_review_result: "TEXT",
      ai_review_summary: "TEXT",
      manual_review_required: "INTEGER NOT NULL DEFAULT 0",
      resolved_at: "TEXT",
      owner_user_id: "INTEGER",
      source_submission_id: "TEXT",
      latitude: "REAL", longitude: "REAL", gps_accuracy: "REAL", address: "TEXT", parking_facility: "TEXT",
      floor: "TEXT", zone: "TEXT", pillar: "TEXT", parking_slot: "TEXT", location_note: "TEXT",
      operational_urgency: "TEXT", sla_minutes: "INTEGER", vehicle_unavailable: "INTEGER NOT NULL DEFAULT 0"
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

    this.addColumnIfMissing('PhotoSubmission', 'user_id', 'INTEGER');
    this.addColumnIfMissing('PhotoSubmission', 'coverage_summary_json', 'TEXT');
    this.addColumnIfMissing('PhotoSubmission', 'damage_summary_json', 'TEXT');
    this.addColumnIfMissing('UploadedPhoto', 'user_id', 'INTEGER');
    this.addColumnIfMissing('UploadedPhoto', 'blur_threshold', 'REAL');
    this.addColumnIfMissing('UploadedPhoto', 'blur_checked_at', 'TEXT');
    for (const [column, definition] of Object.entries({
      latitude: 'REAL', longitude: 'REAL', gps_accuracy: 'REAL', gps_captured_at: 'TEXT', address: 'TEXT', parking_facility: 'TEXT', floor: 'TEXT', zone: 'TEXT', pillar: 'TEXT', parking_slot: 'TEXT', location_note: 'TEXT'
    })) this.addColumnIfMissing('PhotoSubmission', column, definition);
    for (const [column, definition] of Object.entries({
      orientation_angle: 'INTEGER', orientation_label: 'TEXT', orientation_confidence: 'REAL', orientation_passed: 'INTEGER', orientation_checked_at: 'TEXT',
      damage_detected: 'INTEGER', damage_type: 'TEXT', damage_confidence: 'REAL', dirty_detected: 'INTEGER', dirty_confidence: 'REAL', condition_checked_at: 'TEXT'
    })) this.addColumnIfMissing('UploadedPhoto', column, definition);
    this.migrateUsernames();
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_submission_user ON PhotoSubmission(user_id, id DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_photo_user ON UploadedPhoto(user_id, id DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_photo_submission ON UploadedPhoto(submission_id, id ASC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_photo_path ON UploadedPhoto(file_path)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_incident_owner ON Incident(owner_user_id, created_at DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_timeline_incident ON IncidentTimeline(incident_id, id ASC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_comment_incident ON Comment(incident_id, id ASC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_report_incident ON MaintenanceReport(incident_id, id ASC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_incident_gps ON Incident(latitude, longitude)');
    this.db.prepare('DELETE FROM AuthSession WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(new Date().toISOString());
  }

  private migrateUsernames() {
    const columns = this.db.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    this.userHasLegacyEmailColumn = columnNames.has('email');
    if (!columnNames.has('username')) {
      this.db.exec('ALTER TABLE User ADD COLUMN username TEXT');
    }

    const emailProjection = this.userHasLegacyEmailColumn ? ', email' : '';
    const rows = this.db.prepare(`SELECT id, username${emailProjection} FROM User ORDER BY id`).all() as Array<{
      id: number;
      username?: string | null;
      email?: string | null;
    }>;
    const used = new Set<string>();
    const migrate = this.db.transaction(() => {
      for (const row of rows) {
        const source = String(row.username || row.email?.split('@')[0] || '');
        let base = source.trim().toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^[-_]+|[-_]+$/g, '')
          .slice(0, 32);
        if (base.length < 3) base = `user-${row.id}`;
        let candidate = base;
        if (used.has(candidate)) {
          const suffix = `-${row.id}`;
          candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
        }
        let sequence = 2;
        while (used.has(candidate)) {
          const suffix = `-${row.id}-${sequence}`;
          candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
          sequence += 1;
        }
        used.add(candidate);
        this.db.prepare('UPDATE User SET username = ? WHERE id = ?').run(candidate, row.id);
      }
    });
    migrate();

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username_unique ON User(username COLLATE NOCASE);
      CREATE TRIGGER IF NOT EXISTS trg_user_username_insert
      BEFORE INSERT ON User
      WHEN NEW.username IS NULL
        OR length(NEW.username) < 3
        OR length(NEW.username) > 32
        OR NEW.username <> lower(NEW.username)
        OR NEW.username GLOB '*[^a-z0-9_-]*'
      BEGIN
        SELECT RAISE(ABORT, 'invalid username');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_user_username_update
      BEFORE UPDATE OF username ON User
      WHEN NEW.username IS NULL
        OR length(NEW.username) < 3
        OR length(NEW.username) > 32
        OR NEW.username <> lower(NEW.username)
        OR NEW.username GLOB '*[^a-z0-9_-]*'
      BEGIN
        SELECT RAISE(ABORT, 'invalid username');
      END;
    `);
  }

  private addColumnIfMissing(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!columns.some(item => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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

  public getIncidentMapRows(): IncidentMapRow[] {
    return this.db.prepare(`
      SELECT id, plate, latitude, longitude, severity, address, parking_facility,
             floor, zone, pillar, parking_slot, location_note, label, type, created_at
      FROM Incident ORDER BY created_at DESC, id DESC
    `).all() as IncidentMapRow[];
  }

  public getIncidentsForUser(userId: number): Incident[] {
    return this.db.prepare("SELECT * FROM Incident WHERE owner_user_id = ? ORDER BY created_at DESC, id DESC").all(userId) as Incident[];
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

  public getPhotoSubmissions(limit = 50, offset = 0): PhotoSubmission[] {
    return this.db.prepare("SELECT * FROM PhotoSubmission ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset) as PhotoSubmission[];
  }

  public getAllPhotoSubmissions(): PhotoSubmission[] {
    return this.db.prepare("SELECT * FROM PhotoSubmission ORDER BY id DESC").all() as PhotoSubmission[];
  }

  public getPhotoSubmissionsForUser(userId: number, limit = 50, offset = 0): PhotoSubmission[] {
    return this.db.prepare("SELECT * FROM PhotoSubmission WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?").all(userId, limit, offset) as PhotoSubmission[];
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

  public getUploadedPhotoById(photoId: string): UploadedPhoto | null {
    const row = this.db.prepare("SELECT * FROM UploadedPhoto WHERE photo_id = ?").get(photoId);
    return row ? row as UploadedPhoto : null;
  }

  public getUploadedPhotosForUser(userId: number, limit = 100): UploadedPhoto[] {
    return this.db.prepare("SELECT * FROM UploadedPhoto WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit) as UploadedPhoto[];
  }

  public userOwnsSubmission(userId: number, submissionId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM PhotoSubmission WHERE submission_id = ? AND user_id = ?").get(submissionId, userId));
  }

  public userOwnsIncident(userId: number, incidentId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM Incident WHERE id = ? AND owner_user_id = ?").get(incidentId, userId));
  }

  public userOwnsPhoto(userId: number, photoId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM UploadedPhoto WHERE photo_id = ? AND user_id = ?").get(photoId, userId));
  }

  public getUploadedPhotoByPath(filePath: string): UploadedPhoto | null {
    const row = this.db.prepare("SELECT * FROM UploadedPhoto WHERE file_path = ?").get(filePath);
    return row ? row as UploadedPhoto : null;
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
    const status = item.status || (item.type !== 'normal' ? 'assigned' : 'done');
    const assignee = status === 'todo' ? '待派工' : item.type !== 'normal' ? team : '無需處理';

    this.db.prepare(`
      INSERT OR REPLACE INTO Incident(
        id, plate, station, type, label, severity, confidence, detected_time,
        next_booking, hot_station, map_x, map_y, assignee, status, score,
        region, assigned_team, manual_review_required, owner_user_id, source_submission_id,
        latitude, longitude, gps_accuracy, address, parking_facility, floor, zone, pillar, parking_slot, location_note,
        operational_urgency, sla_minutes, vehicle_unavailable, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id, item.plate, item.station, item.type, item.label, item.severity,
      item.confidence, item.detected_time || new Date().toLocaleTimeString('zh-TW', { hour12: false }).substring(0, 5),
      item.next_booking ?? 24, item.hot_station ?? 0, item.map_x ?? 50.0, item.map_y ?? 50.0, assignee,
      status, item.score ?? 0, region, team, item.owner_user_id ?? null, item.source_submission_id ?? null,
      item.latitude ?? null, item.longitude ?? null, item.gps_accuracy ?? null, item.address ?? null, item.parking_facility ?? null,
      item.floor ?? null, item.zone ?? null, item.pillar ?? null, item.parking_slot ?? null, item.location_note ?? null,
      item.operational_urgency ?? null, item.sla_minutes ?? null, item.vehicle_unavailable ?? 0, ts, ts
    );

    this.addTimeline(item.id!, "ai_detected", "AI Detected", `${item.label} | Confidence ${item.confidence}%`);
    if (item.type !== 'normal' && status === 'assigned') {
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

    const allowedFields = new Set([
      'assigned_team', 'region', 'manual_review_required', 'severity', 'resolved_at',
      'auto_closed', 'ai_review_result', 'ai_review_confidence', 'ai_review_summary'
      , 'assigned_user_id', 'issue_count', 'urgency_score', 'urgency_breakdown_json'
    ]);
    for (const [key, val] of Object.entries(extraFields)) {
      if (!allowedFields.has(key)) throw new Error(`Unsupported incident field: ${key}`);
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
    message: string; status: string; attempts?: number; error?: string | null; payloadJson?: string; retryKey?: string;
  }): number {
    const ts = this.nowText();
    const result = this.db.prepare(`
      INSERT INTO NotificationLog(provider, incident_id, event_type, target_id, message, status, attempts, error, created_at, updated_at, payload_json, retry_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      notification.provider, notification.incidentId, notification.eventType, notification.targetId || null,
      notification.message, notification.status, notification.attempts || 0, notification.error || null, ts, ts, notification.payloadJson || null, notification.retryKey || null
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

  public recoverStaleLineNotifications(staleAfterSeconds: number): number {
    const seconds = Math.min(Math.max(Math.floor(staleAfterSeconds), 30), 86_400);
    const cutoff = new Date(Date.now() - seconds * 1000).toISOString();
    const result = this.db.prepare(`
      UPDATE NotificationLog
      SET status = 'queued', error = 'Recovered after process restart', updated_at = ?
      WHERE provider = 'line' AND status = 'sending' AND updated_at <= ?
    `).run(this.nowText(), cutoff);
    return result.changes;
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

  public insertPhotoSubmission(sub: Partial<PhotoSubmission>) {
    this.db.prepare(`
      INSERT INTO PhotoSubmission(submission_id, rental_id, plate, phase, station, parking_location, status, overall_status, ai_summary, coverage_summary_json, damage_summary_json, user_id, latitude, longitude, gps_accuracy, gps_captured_at, address, parking_facility, floor, zone, pillar, parking_slot, location_note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sub.submission_id, sub.rental_id, sub.plate, sub.phase, sub.station || null,
      sub.parking_location || null, sub.status, sub.overall_status, sub.ai_summary || null, sub.coverage_summary_json || null, sub.damage_summary_json || null, sub.user_id ?? null,
      sub.latitude ?? null, sub.longitude ?? null, sub.gps_accuracy ?? null, sub.gps_captured_at ?? null, sub.address ?? null,
      sub.parking_facility ?? null, sub.floor ?? null, sub.zone ?? null, sub.pillar ?? null, sub.parking_slot ?? null, sub.location_note ?? null, this.nowText()
    );
  }

  public insertUploadedPhoto(photo: Partial<UploadedPhoto>) {
    const ts = this.nowText();
    this.db.prepare(`
      INSERT OR REPLACE INTO UploadedPhoto(
        photo_id, submission_id, rental_id, plate, phase, slot, filename, file_path,
        quality_passed, blur_score, blur_threshold, blur_checked_at, is_blur, plate_visible, angle_valid, distance_valid,
        ai_result_json, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      photo.blur_threshold ?? null,
      photo.blur_checked_at ?? null,
      photo.is_blur ? 1 : 0,
      photo.plate_visible ? 1 : 0,
      photo.angle_valid ? 1 : 0,
      photo.distance_valid ? 1 : 0,
      photo.ai_result_json || '',
      photo.user_id ?? null,
      ts
    );
  }

  public updateUploadedPhotoSubmission(photoId: string, submissionId: string, aiResultJson: string, userId?: number) {
    const current = this.getUploadedPhotoById(photoId);
    let existing: any = {};
    try { existing = current?.ai_result_json ? JSON.parse(current.ai_result_json) : {}; } catch { existing = {}; }
    const composed = JSON.stringify(existing);
    this.db.prepare(`
      UPDATE UploadedPhoto SET submission_id = ?, ai_result_json = ?, user_id = COALESCE(user_id, ?) WHERE photo_id = ?
    `).run(submissionId, composed, userId ?? null, photoId);
  }

  public updatePhotoGuidance(photoId: string, guidance: unknown, userId: number) {
    const current = this.getUploadedPhotoById(photoId);
    let existing: any = {};
    try { existing = current?.ai_result_json ? JSON.parse(current.ai_result_json) : {}; } catch { existing = {}; }
    this.db.prepare('UPDATE UploadedPhoto SET ai_result_json = ? WHERE photo_id = ? AND user_id = ?')
      .run(JSON.stringify({ ...existing, guidance }), photoId, userId);
  }

  public hasSuccessfulNotification(incidentId: string, eventType: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM NotificationLog WHERE provider = 'line' AND incident_id = ? AND event_type = ? AND status IN ('queued', 'sending', 'sent') LIMIT 1`).get(incidentId, eventType));
  }

  public updatePhotoOrientation(photoId: string, result: { angle: number; label: string; confidence: number; passed: boolean }, userId: number) {
    this.db.prepare(`UPDATE UploadedPhoto SET orientation_angle = ?, orientation_label = ?, orientation_confidence = ?, orientation_passed = ?, orientation_checked_at = ? WHERE photo_id = ? AND user_id = ?`)
      .run(result.angle, result.label, result.confidence, result.passed ? 1 : 0, new Date().toISOString(), photoId, userId);
  }

  public updatePhotoCondition(photoId: string, result: any, userId: number) {
    const current = this.getUploadedPhotoById(photoId);
    let existing: any = {};
    try { existing = current?.ai_result_json ? JSON.parse(current.ai_result_json) : {}; } catch { existing = {}; }
    const damage = result.persistedDamage || result;
    this.db.prepare(`UPDATE UploadedPhoto SET damage_detected = ?, damage_type = ?, damage_confidence = ?, dirty_detected = ?, dirty_confidence = ?, condition_checked_at = ? WHERE photo_id = ? AND user_id = ?`)
      .run(result.damage?.detected ? 1 : 0, result.damage?.type || null, result.damage?.confidence ?? null, result.dirty?.detected ? 1 : 0, result.dirty?.confidence ?? 0, damage.checked_at || new Date().toISOString(), photoId, userId);
    this.db.prepare('UPDATE UploadedPhoto SET ai_result_json = ? WHERE photo_id = ? AND user_id = ?')
      .run(JSON.stringify({ ...existing, damage }), photoId, userId);
  }

  public setVehicleAvailability(plate: string, unavailable: boolean, incidentId: string | null) {
    this.db.prepare(`INSERT INTO VehicleAvailability(plate, status, reason_incident_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(plate) DO UPDATE SET status = excluded.status, reason_incident_id = excluded.reason_incident_id, updated_at = excluded.updated_at`)
      .run(plate, unavailable ? 'UNAVAILABLE' : 'AVAILABLE', incidentId, this.nowText());
  }

  // --- Authentication, sessions, and audit ---
  public createUser(username: string, passwordHash: string, role: UserRole = 'user', isActive = true): UserAccount {
    const ts = this.nowText();
    const normalizedUsername = username.trim().toLowerCase();
    const result = this.userHasLegacyEmailColumn
      ? this.db.prepare(`
          INSERT INTO User(username, email, password_hash, role, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          normalizedUsername,
          `legacy-${randomBytes(12).toString('hex')}@invalid.local`,
          passwordHash,
          role,
          isActive ? 1 : 0,
          ts,
          ts
        )
      : this.db.prepare(`
          INSERT INTO User(username, password_hash, role, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(normalizedUsername, passwordHash, role, isActive ? 1 : 0, ts, ts);
    return this.getUserById(Number(result.lastInsertRowid))!;
  }

  public getUserByUsername(username: string): UserAccount | null {
    const row = this.db.prepare(`
      SELECT id, username, password_hash, role, is_active, created_at, updated_at, last_login_at
      FROM User WHERE username = ? COLLATE NOCASE
    `).get(username.trim().toLowerCase());
    return row ? row as UserAccount : null;
  }

  public getUserById(userId: number): UserAccount | null {
    const row = this.db.prepare(`
      SELECT id, username, password_hash, role, is_active, created_at, updated_at, last_login_at
      FROM User WHERE id = ?
    `).get(userId);
    return row ? row as UserAccount : null;
  }

  /** SQLite CHECK constraints require a table rebuild. Preserve IDs, columns, indexes,
   * triggers and all referencing sessions/audit rows; run only on the old two-role schema. */
  private migrateOperatorRole() {
    const table = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'User'").get() as { sql: string } | undefined;
    if (!table) return;
    const oldCheck = /CHECK\s*\(\s*role\s+IN\s*\(\s*'user'\s*,\s*'admin'\s*\)\s*\)/i;
    if (!oldCheck.test(table.sql)) return;
    const columns = (this.db.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>).map(column => `"${column.name.replace(/"/g, '""')}"`).join(', ');
    const dependentSql = this.db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'User' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
    const createSql = table.sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["\[]?User["\]]?/i, 'CREATE TABLE User_role_migration')
      .replace(oldCheck, "CHECK(role IN ('user', 'operator', 'admin'))");
    this.db.pragma('foreign_keys = OFF');
    try {
      this.db.transaction(() => {
        this.db.exec(createSql);
        this.db.exec(`INSERT INTO User_role_migration(${columns}) SELECT ${columns} FROM User`);
        this.db.exec('DROP TABLE User');
        this.db.exec('ALTER TABLE User_role_migration RENAME TO User');
        for (const item of dependentSql) this.db.exec(item.sql);
        if ((this.db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Role migration failed foreign key validation');
      })();
    } finally { this.db.pragma('foreign_keys = ON'); }
  }

  public saveNotificationPayload(id: number, payloadJson: string, retryKey: string) {
    this.db.prepare('UPDATE NotificationLog SET payload_json = ?, retry_key = ? WHERE id = ?').run(payloadJson, retryKey, id);
  }

  public getAssignableUsers() {
    return this.db.prepare("SELECT id, username, role FROM User WHERE role IN ('admin', 'operator') AND is_active = 1 ORDER BY username").all() as Array<{ id: number; username: string; role: 'admin' | 'operator' }>;
  }

  public recordStageMetric(stage: string, traceId: string | null, startedAt: number, durationMs: number, outcome = 'ok') {
    this.db.prepare('INSERT INTO StageMetric(stage, trace_id, started_at_ms, duration_ms, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(stage, traceId, startedAt, Math.max(0, durationMs), outcome, new Date().toISOString());
    this.db.prepare('DELETE FROM StageMetric WHERE id <= (SELECT MAX(id) - 5000 FROM StageMetric)').run();
  }

  public getMetricStart(stage: string, traceId: string): number | null {
    const row = this.db.prepare('SELECT started_at_ms FROM StageMetric WHERE stage = ? AND trace_id = ? ORDER BY id ASC LIMIT 1').get(stage, traceId) as any;
    return row?.started_at_ms ?? null;
  }

  public getStageMetrics() {
    return this.db.prepare('SELECT stage, trace_id AS traceId, started_at_ms AS startedAt, duration_ms AS durationMs, outcome, created_at AS createdAt FROM StageMetric ORDER BY id DESC LIMIT 500').all() as any[];
  }

  public getUnassignedUrgentIncidents(ageMinutes: number): Incident[] {
    const cutoff = new Date(Date.now() - ageMinutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);
    return this.db.prepare(`SELECT * FROM Incident WHERE status = 'todo'
      AND COALESCE(urgency_score, CASE severity WHEN 'high' THEN 8 WHEN 'medium' THEN 5 ELSE 1 END) >= 8
      AND created_at <= ? AND id NOT IN (SELECT incident_id FROM IncidentEscalation)`)
      .all(cutoff) as Incident[];
  }

  public claimAssignmentEscalation(incidentId: string): boolean {
    return this.db.prepare(`INSERT OR IGNORE INTO IncidentEscalation(incident_id, created_at)
      SELECT id, ? FROM Incident WHERE id = ? AND status = 'todo'`)
      .run(new Date().toISOString(), incidentId).changes === 1;
  }

  public isOpen(): boolean { return this.db.open; }

  /** Keep the claim and its task update atomic, including across SQLite connections. */
  public assignIncidentToUser(incidentId: string, user: UserAccount, selfOnly: boolean): boolean {
    return this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE Incident SET status = 'assigned', assignee = ?, assigned_user_id = ?, updated_at = ?
        WHERE id = ? AND status IN ('todo', 'assigned')
          AND (? = 0 OR assigned_user_id IS NULL OR assigned_user_id = ?)
      `).run(user.username, user.id, this.nowText(), incidentId, selfOnly ? 1 : 0, user.id);
      if (result.changes !== 1) return false;
      this.updateDispatchTaskStatus(incidentId, 'assigned', user.username);
      this.addTimeline(incidentId, 'assigned', selfOnly ? 'Self Assigned' : 'Assigned to Operator', user.username);
      return true;
    })();
  }

  public countAdmins(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM User WHERE role = 'admin'").get() as { count: number };
    return row.count;
  }

  public updateUserLastLogin(userId: number) {
    const ts = this.nowText();
    this.db.prepare('UPDATE User SET last_login_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, userId);
  }

  public setUserRole(userId: number, role: UserRole) {
    this.db.prepare('UPDATE User SET role = ?, updated_at = ? WHERE id = ?').run(role, this.nowText(), userId);
  }

  public setUserActive(userId: number, active: boolean) {
    this.db.prepare('UPDATE User SET is_active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, this.nowText(), userId);
  }

  public createAuthSession(userId: number, tokenHash: string, csrfTokenHash: string, expiresAt: string) {
    const ts = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO AuthSession(user_id, token_hash, csrf_token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, tokenHash, csrfTokenHash, expiresAt, ts, ts);
  }

  public getAuthSession(tokenHash: string): AuthSessionRecord | null {
    const row = this.db.prepare(`
      SELECT s.*, u.username, u.role, u.is_active
      FROM AuthSession s
      JOIN User u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash);
    return row ? row as AuthSessionRecord : null;
  }

  public revokeAuthSession(tokenHash: string): boolean {
    const result = this.db.prepare(`
      UPDATE AuthSession SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), tokenHash);
    return result.changes > 0;
  }

  public revokeAllAuthSessions(userId: number): number {
    const result = this.db.prepare(`
      UPDATE AuthSession SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), userId);
    return result.changes;
  }

  public touchAuthSession(tokenHash: string) {
    this.db.prepare('UPDATE AuthSession SET last_seen_at = ? WHERE token_hash = ?').run(new Date().toISOString(), tokenHash);
  }

  public updateAuthSessionCsrf(tokenHash: string, csrfTokenHash: string) {
    this.db.prepare('UPDATE AuthSession SET csrf_token_hash = ?, last_seen_at = ? WHERE token_hash = ?')
      .run(csrfTokenHash, new Date().toISOString(), tokenHash);
  }

  public deleteExpiredSessions() {
    this.db.prepare('DELETE FROM AuthSession WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(new Date().toISOString());
  }

  public addAuditLog(userId: number | null, action: string, resourceType?: string, resourceId?: string, metadata: Record<string, unknown> = {}) {
    const forbidden = /password|token|secret|authorization|cookie|api.?key/i;
    const redact = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, forbidden.test(key) ? '[REDACTED]' : redact(item)]));
      }
      return value;
    };
    this.db.prepare(`
      INSERT INTO AuditLog(user_id, action, resource_type, resource_id, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, action, resourceType || null, resourceId || null, new Date().toISOString(), JSON.stringify(redact(metadata)));
  }

  public getAuditLogs() {
    return this.db.prepare('SELECT * FROM AuditLog ORDER BY id ASC').all() as any[];
  }

  public getRecentAuditLogs(limit = 200) {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
    return this.db.prepare(`
      SELECT a.id, a.user_id, a.action, a.resource_type, a.resource_id, a.timestamp, a.metadata, u.username
      FROM AuditLog a
      LEFT JOIN User u ON u.id = a.user_id
      ORDER BY a.timestamp DESC, a.id DESC
      LIMIT ?
    `).all(safeLimit) as any[];
  }

  public addAgentTaskHistory(input: {
    userId: number | null;
    taskType: string;
    promptSummary: string;
    resultSummary: string;
    model?: string | null;
    status: 'completed' | 'failed';
  }): number {
    const result = this.db.prepare(`
      INSERT INTO AgentTaskHistory(user_id, task_type, prompt_summary, result_summary, model, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.userId, input.taskType, input.promptSummary, input.resultSummary, input.model || null, input.status, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  public getAgentTaskHistory(limit = 20) {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
    return this.db.prepare(`
      SELECT h.id, h.task_type, h.prompt_summary, h.result_summary, h.model, h.status, h.created_at,
             u.username
      FROM AgentTaskHistory h
      LEFT JOIN User u ON u.id = h.user_id
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT ?
    `).all(safeLimit) as any[];
  }

  public createAgentActionDraft(input: {
    id: string;
    draftType: 'dispatch' | 'line';
    incidentId: string;
    payload: Record<string, unknown>;
    createdBy: number;
    expiresAt: string;
  }) {
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO AgentActionDraft(id, draft_type, incident_id, payload_json, created_by, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(input.id, input.draftType, input.incidentId, JSON.stringify(input.payload), input.createdBy, input.expiresAt, createdAt);
    return this.getAgentActionDraft(input.id);
  }

  public getAgentActionDraft(id: string) {
    return this.db.prepare('SELECT * FROM AgentActionDraft WHERE id = ?').get(id) as any;
  }

  public claimAgentActionDraft(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE AgentActionDraft SET status = 'processing'
      WHERE id = ? AND status = 'pending' AND expires_at > ?
    `).run(id, new Date().toISOString());
    return result.changes === 1;
  }

  public finishAgentActionDraft(id: string, status: 'confirmed' | 'failed' | 'expired') {
    this.db.prepare(`
      UPDATE AgentActionDraft SET status = ?, confirmed_at = CASE WHEN ? = 'confirmed' THEN ? ELSE confirmed_at END
      WHERE id = ?
    `).run(status, status, new Date().toISOString(), id);
  }

  public close() {
    this.db.close();
  }

  public getMaintenanceReportCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM MaintenanceReport").get() as any;
    return row ? row.count : 0;
  }
}
