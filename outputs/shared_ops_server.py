from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import request, error
import json
import mimetypes
import os
import sqlite3
import time
import base64
import re
import random


ROOT = Path(__file__).resolve().parent
INDEX_FILE = ROOT / "irent-ops-dashboard.html"
DB_FILE = Path(os.environ.get("DATABASE_PATH", ROOT / "irent_ops.db"))
PORT = int(os.environ.get("PORT", "5188"))
UPLOAD_DIR = ROOT / "uploads"


SEED_INCIDENTS = [
    {"id": "INC-302", "plate": "ABC-1234", "station": "台北101站", "type": "damage", "label": "新增右後門刮傷", "severity": "high", "confidence": 96, "time": "08:32", "nextBooking": 28, "hotStation": True, "x": 69, "y": 24, "assignee": "待客服確認", "status": "todo", "score": 0},
    {"id": "INC-303", "plate": "XYZ-8888", "station": "中山站", "type": "cleaning", "label": "車內後座垃圾", "severity": "high", "confidence": 91, "time": "08:36", "nextBooking": 18, "hotStation": True, "x": 43, "y": 39, "assignee": "王先生 600m", "status": "assigned", "score": 0},
    {"id": "INC-304", "plate": "KKB-5200", "station": "松山機場", "type": "cleaning", "label": "飲料杯與地墊髒污", "severity": "medium", "confidence": 88, "time": "08:41", "nextBooking": 52, "hotStation": True, "x": 76, "y": 57, "assignee": "林小姐 1.1km", "status": "assigned", "score": 0},
    {"id": "INC-305", "plate": "RNT-7788", "station": "台北車站", "type": "damage", "label": "疑似保桿擦傷", "severity": "medium", "confidence": 83, "time": "08:47", "nextBooking": 74, "hotStation": True, "x": 31, "y": 26, "assignee": "待客服確認", "status": "todo", "score": 0},
    {"id": "INC-306", "plate": "QAZ-2468", "station": "士林站", "type": "normal", "label": "照片通過檢查", "severity": "low", "confidence": 94, "time": "08:52", "nextBooking": 140, "hotStation": False, "x": 22, "y": 63, "assignee": "無需處理", "status": "done", "score": 0},
    {"id": "INC-307", "plate": "TPE-1688", "station": "信義安和站", "type": "cleaning", "label": "一般灰塵", "severity": "low", "confidence": 79, "time": "08:58", "nextBooking": 126, "hotStation": False, "x": 58, "y": 72, "assignee": "排入例行清潔", "status": "todo", "score": 0},
]

DAMAGE_HOTSPOTS = [["右後門", 12], ["前保桿", 9], ["左後輪弧", 7], ["後保桿", 5], ["車頂", 2]]
REGION_TEAMS = [
    ("\u5317\u5340\u5c0f\u968a", "\u5317\u5340", ["\u53f0\u5317", "\u81fa\u5317", "\u65b0\u5317", "\u57fa\u9686", "\u677f\u6a4b", "\u4e2d\u5c71", "\u58eb\u6797", "\u4fe1\u7fa9"]),
    ("\u6843\u7af9\u82d7\u5c0f\u968a", "\u6843\u7af9\u82d7", ["\u6843\u5712", "\u65b0\u7af9", "\u82d7\u6817"]),
    ("\u4e2d\u5340\u5c0f\u968a", "\u4e2d\u5340", ["\u53f0\u4e2d", "\u81fa\u4e2d", "\u5f70\u5316", "\u5357\u6295"]),
    ("\u5357\u5340\u5c0f\u968a", "\u5357\u5340", ["\u53f0\u5357", "\u81fa\u5357", "\u9ad8\u96c4", "\u5c4f\u6771"]),
    ("\u6771\u5340\u5c0f\u968a", "\u6771\u5340", ["\u5b9c\u862d", "\u82b1\u84ee", "\u53f0\u6771", "\u81fa\u6771"]),
]


def now_text():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def connect():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    UPLOAD_DIR.mkdir(exist_ok=True)
    with connect() as conn:
        conn.executescript(
            """
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
            """
        )
        migrate_db(conn)
        conn.execute(
            "INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)",
            ("lineGroup", "iRent Ops Alerts", now_text()),
        )
        conn.execute(
            "INSERT OR IGNORE INTO Settings(key, value, updated_at) VALUES (?, ?, ?)",
            ("damageHotspots", json.dumps(DAMAGE_HOTSPOTS, ensure_ascii=False), now_text()),
        )
        if conn.execute("SELECT COUNT(*) FROM Incident").fetchone()[0] == 0:
            for item in SEED_INCIDENTS:
                insert_incident(conn, item, notify=False)
        for row in conn.execute("SELECT id, station FROM Incident WHERE assigned_team = '' OR region = ''"):
            team, region = assign_team(row["station"])
            conn.execute("UPDATE Incident SET assigned_team = ?, region = ?, assignee = CASE WHEN assignee IN ('?????', '?????') THEN ? ELSE assignee END WHERE id = ?", (team, region, team, row["id"]))


def migrate_db(conn):
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(Incident)")}
    columns = {
        "region": "TEXT DEFAULT ''",
        "assigned_team": "TEXT DEFAULT ''",
        "auto_closed": "INTEGER NOT NULL DEFAULT 0",
        "ai_review_confidence": "INTEGER",
        "ai_review_result": "TEXT",
        "ai_review_summary": "TEXT",
        "manual_review_required": "INTEGER NOT NULL DEFAULT 0",
        "resolved_at": "TEXT",
    }
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE Incident ADD COLUMN {name} {definition}")
    report_existing = {row["name"] for row in conn.execute("PRAGMA table_info(MaintenanceReport)")}
    if "ai_review_summary" not in report_existing:
        conn.execute("ALTER TABLE MaintenanceReport ADD COLUMN ai_review_summary TEXT")


def assign_team(station):
    for team, region, keywords in REGION_TEAMS:
        if any(keyword in station for keyword in keywords):
            return team, region
    return "\u5317\u5340\u5c0f\u968a", "\u5317\u5340"


def row_to_incident(row):
    return {
        "id": row["id"],
        "plate": row["plate"],
        "station": row["station"],
        "type": row["type"],
        "label": row["label"],
        "severity": row["severity"],
        "confidence": row["confidence"],
        "time": row["detected_time"],
        "nextBooking": row["next_booking"],
        "hotStation": bool(row["hot_station"]),
        "x": row["map_x"],
        "y": row["map_y"],
        "assignee": row["assignee"],
        "status": row["status"],
        "score": row["score"],
        "region": row["region"],
        "assignedTeam": row["assigned_team"],
        "autoClosed": bool(row["auto_closed"]),
        "aiReviewConfidence": row["ai_review_confidence"],
        "aiReviewResult": row["ai_review_result"],
        "aiReviewSummary": row["ai_review_summary"],
        "manualReviewRequired": bool(row["manual_review_required"]),
        "resolvedAt": row["resolved_at"],
    }


def get_setting(conn, key, default=""):
    env_webhook = os.environ.get("SLACK_WEBHOOK_URL")
    if key == "slackWebhook" and env_webhook:
        return env_webhook
    row = conn.execute("SELECT value FROM Settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        """
        INSERT INTO Settings(key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, now_text()),
    )


def add_timeline(conn, incident_id, event_type, title, body=""):
    conn.execute(
        "INSERT INTO IncidentTimeline(incident_id, event_type, title, body, created_at) VALUES (?, ?, ?, ?, ?)",
        (incident_id, event_type, title, body, now_text()),
    )


def slack_message(incident, event_type, extra=""):
    headline = {
        "ai_detected": "AI 建立 Incident",
        "dispatch": "派工更新",
        "comment": "客服留言",
        "in_progress": "任務開始",
        "resolved": "任務完成",
        "reopen": "Incident Reopen",
    }.get(event_type, "iRent Ops 通知")
    lines = [
        f"*{headline}* | {incident['plate']}",
        f"事件: {incident['label']}",
        f"位置: {incident['station']}",
        f"AI Confidence: {incident['confidence']}%",
        f"狀態: {incident['status']}",
        f"負責對象: {incident['assignee']}",
    ]
    if extra:
        lines.append(f"補充: {extra}")
    return "\n".join(lines)


def send_slack(conn, incident_id, event_type, message):
    webhook = get_setting(conn, "slackWebhook")
    attempts = 0
    status = "not_configured"
    last_error = "SLACK_WEBHOOK_URL or Settings.slackWebhook is not configured"
    if webhook and webhook.startswith("https://hooks.slack.com/services/"):
        for _ in range(2):
            attempts += 1
            try:
                req = request.Request(
                    webhook,
                    data=json.dumps({"text": message}, ensure_ascii=False).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with request.urlopen(req, timeout=10) as response:
                    response.read()
                    if 200 <= response.status < 300:
                        status = "sent"
                        last_error = ""
                        break
                    status = "failed"
                    last_error = f"HTTP {response.status}"
            except error.HTTPError as exc:
                status = "failed"
                last_error = exc.read().decode("utf-8", errors="replace")
            except Exception as exc:
                status = "failed"
                last_error = str(exc)
    conn.execute(
        """
        INSERT INTO SlackNotification(incident_id, event_type, message, status, attempts, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (incident_id, event_type, message, status, attempts, last_error, now_text()),
    )
    if status == "sent":
        add_timeline(conn, incident_id, "slack_sent", "Slack Sent", message)
    else:
        add_timeline(conn, incident_id, "slack_failed", "Slack Failed", last_error)
    return status


def incident_by_id(conn, incident_id):
    row = conn.execute("SELECT * FROM Incident WHERE id = ?", (incident_id,)).fetchone()
    return row_to_incident(row) if row else None


def insert_incident(conn, item, notify=True):
    ts = now_text()
    team, region = assign_team(item["station"])
    status = "assigned" if item["type"] != "normal" else item.get("status", "done")
    assignee = team if item["type"] != "normal" else "????"
    conn.execute(
        """
        INSERT OR REPLACE INTO Incident(
          id, plate, station, type, label, severity, confidence, detected_time,
          next_booking, hot_station, map_x, map_y, assignee, status, score,
          region, assigned_team, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item["id"], item["plate"], item["station"], item["type"], item["label"], item["severity"],
            int(item["confidence"]), item.get("time", time.strftime("%H:%M")), int(item["nextBooking"]),
            1 if item.get("hotStation") else 0, float(item["x"]), float(item["y"]), assignee,
            status, int(item.get("score", 0)), region, team, ts, ts,
        ),
    )
    add_timeline(conn, item["id"], "ai_detected", "AI Detected", f"{item['label']} ? Confidence {item['confidence']}%")
    if item["type"] != "normal":
        add_timeline(conn, item["id"], "assigned", "Auto Assigned", f"{region} ? {team}")
    task_type = "Inspection" if item["type"] == "damage" else "Cleaning" if item["type"] == "cleaning" else "Release"
    conn.execute(
        "INSERT INTO DispatchTask(incident_id, task_type, assignee, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (item["id"], task_type, assignee, status, ts, ts),
    )
    incident = incident_by_id(conn, item["id"])
    if notify:
        send_slack(conn, item["id"], "ai_detected", slack_message(incident, "ai_detected"))

def save_report_photo(incident_id, photo):
    if not photo:
        return ""
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", photo.get("name") or "report.jpg")
    suffix = Path(name).suffix or ".jpg"
    filename = f"{incident_id}_{int(time.time())}{suffix}"
    path = UPLOAD_DIR / filename
    data_url = photo.get("data", "")
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    path.write_bytes(base64.b64decode(data_url))
    return f"uploads/{filename}"


PHOTO_SLOTS = {
    "front": "車頭",
    "right_side": "右側",
    "rear": "車尾",
    "left_side": "左側",
    "front_interior": "前座內裝",
    "backseat_interior": "後座內裝",
}


def next_code(conn, table, column, prefix):
    count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] + 1
    return f"{prefix}-{count:03d}"


def decode_photo_data(data_url):
    if not data_url:
        return b""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    try:
        return base64.b64decode(data_url)
    except Exception:
        return b""


def save_uploaded_photo(conn, payload, photo_id=None, submission_id=None):
    ts = now_text()
    photo_id = photo_id or next_code(conn, "UploadedPhoto", "photo_id", "PHOTO")
    filename = re.sub(r"[^A-Za-z0-9_.-]", "_", payload.get("filename") or f"{photo_id}.jpg")
    suffix = Path(filename).suffix or ".jpg"
    stored_name = f"{photo_id}_{int(time.time())}{suffix}"
    file_path = UPLOAD_DIR / stored_name
    data = decode_photo_data(payload.get("imageData") or payload.get("data") or "")
    if data:
        file_path.write_bytes(data)
    conn.execute(
        """
        INSERT OR REPLACE INTO UploadedPhoto(
          photo_id, submission_id, rental_id, plate, phase, slot, filename, file_path,
          quality_passed, blur_score, is_blur, plate_visible, angle_valid, distance_valid,
          ai_result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            photo_id,
            submission_id,
            payload.get("rentalId") or payload.get("rental_id") or "",
            payload.get("plate") or "",
            payload.get("phase") or "pickup",
            payload.get("slot") or "front",
            filename,
            f"uploads/{stored_name}" if data else "",
            0,
            None,
            0,
            1,
            1,
            1,
            "",
            ts,
        ),
    )
    return photo_id


def mock_quality_check(photo):
    text = " ".join(str(photo.get(key, "")) for key in ("filename", "slot", "imageData", "data")).lower()
    is_blur = any(word in text for word in ("blur", "bad", "dark", "fail"))
    blur_score = 42.1 if is_blur else 135.2
    plate_visible = "no_plate" not in text
    angle_valid = "bad_angle" not in text
    distance_valid = "too_close" not in text and "too_far" not in text
    passed = not is_blur and plate_visible and angle_valid and distance_valid
    message = "照片品質通過" if passed else "照片品質不足，請重新拍攝"
    return {
        "passed": passed,
        "blurScore": blur_score,
        "isBlur": is_blur,
        "plateVisible": plate_visible,
        "angleValid": angle_valid,
        "distanceValid": distance_valid,
        "message": message,
    }


def mock_vehicle_ai_analysis(submission):
    results = []
    for index, photo in enumerate(submission.get("photos") or []):
        slot = photo.get("slot") or "front"
        text = " ".join(str(photo.get(key, "")) for key in ("filename", "slot", "note")).lower()
        is_interior = slot in ("front_interior", "backseat_interior")
        quality = bool(photo.get("qualityPassed", True))
        if is_interior:
            dirty = any(word in text for word in ("dirty", "trash", "stain", "髒", "垃圾"))
            result = {
                "slot": slot,
                "qualityPassed": quality,
                "damageDetected": False,
                "cleanliness": "dirty" if dirty else "normal",
                "confidence": 0.89 if dirty else 0.93,
            }
        else:
            damaged = any(word in text for word in ("scratch", "dent", "damage", "crack", "擦傷", "凹", "破"))
            result = {
                "slot": slot,
                "qualityPassed": quality,
                "damageDetected": damaged,
                "damageType": "scratch" if damaged else None,
                "damageLocation": PHOTO_SLOTS.get(slot, slot),
                "isNewDamage": damaged and submission.get("phase") == "return",
                "confidence": 0.88 if damaged else 0.92,
            }
        results.append(result)
    return results


def create_incident_from_ai_result(conn, submission, ai_result):
    created = []
    for result in ai_result:
        should_create = result.get("damageDetected") or result.get("cleanliness") == "dirty"
        if not should_create:
            continue
        incident_id = next_code(conn, "Incident", "id", "INC-AI")
        is_dirty = result.get("cleanliness") == "dirty"
        label = "車內清潔異常" if is_dirty else f"{result.get('damageLocation') or result.get('slot')} 新增車損"
        item = {
            "id": incident_id,
            "plate": submission.get("plate") or "UNKNOWN",
            "station": submission.get("station") or submission.get("parkingLocation") or "租客回報位置",
            "type": "cleaning" if is_dirty else "damage",
            "label": label,
            "severity": "high" if not is_dirty else "medium",
            "confidence": round(float(result.get("confidence", 0.86)) * 100),
            "time": time.strftime("%H:%M"),
            "nextBooking": 24,
            "hotStation": True,
            "x": random.randint(24, 76),
            "y": random.randint(24, 76),
            "assignee": "auto",
            "status": "assigned",
            "score": 0,
        }
        insert_incident(conn, item, notify=True)
        add_timeline(
            conn,
            incident_id,
            "photo_ai_analysis",
            "Photo AI Analysis",
            f"rentalId={submission.get('rentalId')} phase={submission.get('phase')} slot={result.get('slot')}",
        )
        created.append(incident_id)
    return created


def row_to_submission(row):
    return {
        "submissionId": row["submission_id"],
        "rentalId": row["rental_id"],
        "plate": row["plate"],
        "phase": row["phase"],
        "station": row["station"],
        "parkingLocation": row["parking_location"],
        "status": row["status"],
        "overallStatus": row["overall_status"],
        "aiSummary": row["ai_summary"],
        "createdAt": row["created_at"],
    }


def row_to_photo(row):
    return {
        "photoId": row["photo_id"],
        "submissionId": row["submission_id"],
        "rentalId": row["rental_id"],
        "plate": row["plate"],
        "phase": row["phase"],
        "slot": row["slot"],
        "filename": row["filename"],
        "filePath": row["file_path"],
        "qualityPassed": bool(row["quality_passed"]),
        "blurScore": row["blur_score"],
        "isBlur": bool(row["is_blur"]),
        "plateVisible": bool(row["plate_visible"]),
        "angleValid": bool(row["angle_valid"]),
        "distanceValid": bool(row["distance_valid"]),
        "aiResult": json.loads(row["ai_result_json"] or "{}"),
        "createdAt": row["created_at"],
    }


def run_ai_review(note, photo_path):
    text = (note or "").lower()
    fail_words = ("fail", "異常", "未完成", "仍有", "不通過", "髒", "破損")
    if any(word in text for word in fail_words):
        return "fail", 82, "AI Review found unresolved issue signals in the team note. Human confirmation is required."
    if not photo_path:
        return "uncertain", 78, "AI Review needs a completion photo before it can safely close this incident."
    return "pass", 94, "AI Review matched the uploaded completion photo with the incident context and found no remaining blocker."


def ops_metrics(conn):
    total_reports = conn.execute("SELECT COUNT(*) FROM MaintenanceReport").fetchone()[0]
    auto_closed = conn.execute("SELECT COUNT(*) FROM Incident WHERE auto_closed = 1").fetchone()[0]
    waiting = conn.execute("SELECT COUNT(*) FROM Incident WHERE status = 'waiting_review'").fetchone()[0]
    rate = round((auto_closed / total_reports) * 100) if total_reports else 0
    reduced = auto_closed
    saved_minutes = auto_closed * 18 + max(waiting, 0) * 6
    return {
        "autoCloseRate": f"{rate}%",
        "manualReviewReduced": reduced,
        "avgTimeSaved": f"{saved_minutes}\u5206",
    }


def project_state():
    with connect() as conn:
        incidents = [row_to_incident(row) for row in conn.execute("SELECT * FROM Incident ORDER BY created_at DESC, id DESC")]
        timelines = {}
        for row in conn.execute("SELECT * FROM IncidentTimeline ORDER BY id ASC"):
            timelines.setdefault(row["incident_id"], []).append(dict(row))
        comments = {}
        for row in conn.execute("SELECT * FROM Comment ORDER BY id ASC"):
            comments.setdefault(row["incident_id"], []).append(dict(row))
        notifications = [dict(row) for row in conn.execute("SELECT * FROM SlackNotification ORDER BY id DESC LIMIT 50")]
        reports = {}
        for row in conn.execute("SELECT * FROM MaintenanceReport ORDER BY id ASC"):
            reports.setdefault(row["incident_id"], []).append(dict(row))
        submissions = [row_to_submission(row) for row in conn.execute("SELECT * FROM PhotoSubmission ORDER BY id DESC LIMIT 50")]
        uploaded_photos = [row_to_photo(row) for row in conn.execute("SELECT * FROM UploadedPhoto ORDER BY id DESC LIMIT 100")]
        line_logs = [
            {
                "title": f"{row['status']} · {row['event_type']} · {row['incident_id'] or '-'}",
                "time": row["created_at"],
                "group": get_setting(conn, "lineGroup", "iRent Ops Alerts"),
                "message": row["message"],
            }
            for row in notifications
        ]
        return {
            "incidents": incidents,
            "damageHotspots": json.loads(get_setting(conn, "damageHotspots", json.dumps(DAMAGE_HOTSPOTS, ensure_ascii=False))),
            "lineGroup": get_setting(conn, "lineGroup", "iRent Ops Alerts"),
            "slackConnected": bool(get_setting(conn, "slackWebhook")),
            "slackWebhook": "",
            "lineLogs": line_logs,
            "timelines": timelines,
            "comments": comments,
            "slackNotifications": notifications,
            "maintenanceReports": reports,
            "photoSubmissions": submissions,
            "uploadedPhotos": uploaded_photos,
            "opsMetrics": ops_metrics(conn),
        }


def handle_action(payload):
    action = payload.get("action")
    incident_id = payload.get("incidentId")
    with connect() as conn:
        incident = incident_by_id(conn, incident_id)
        if not incident:
            return 404, {"ok": False, "error": "Incident not found"}
        if action == "dispatch":
            team, region = assign_team(incident["station"])
            conn.execute("UPDATE Incident SET assignee = ?, assigned_team = ?, region = ?, status = ?, manual_review_required = 0, updated_at = ? WHERE id = ?", (team, team, region, "assigned", now_text(), incident_id))
            conn.execute("UPDATE DispatchTask SET assignee = ?, status = ?, updated_at = ? WHERE incident_id = ?", (team, "assigned", now_text(), incident_id))
            add_timeline(conn, incident_id, "assigned", "Reassigned", f"{region} / {team}")
            incident = incident_by_id(conn, incident_id)
            send_slack(conn, incident_id, "dispatch", slack_message(incident, "dispatch"))
        elif action == "comment":
            body = (payload.get("body") or "").strip()
            author = (payload.get("author") or "??").strip()
            if not body:
                return 400, {"ok": False, "error": "Comment body is required"}
            conn.execute("INSERT INTO Comment(incident_id, author, body, created_at) VALUES (?, ?, ?, ?)", (incident_id, author, body, now_text()))
            add_timeline(conn, incident_id, "comment", "Comment", f"{author}: {body}")
            send_slack(conn, incident_id, "comment", slack_message(incident, "comment", body))
        elif action == "in_progress":
            conn.execute("UPDATE Incident SET status = ?, updated_at = ? WHERE id = ?", ("in_progress", now_text(), incident_id))
            conn.execute("UPDATE DispatchTask SET status = ?, updated_at = ? WHERE incident_id = ?", ("in_progress", now_text(), incident_id))
            add_timeline(conn, incident_id, "in_progress", "In Progress", "Task started")
            incident = incident_by_id(conn, incident_id)
            send_slack(conn, incident_id, "in_progress", slack_message(incident, "in_progress"))
        elif action == "resolve":
            conn.execute("UPDATE Incident SET status = ?, severity = ?, assignee = ?, manual_review_required = 0, resolved_at = ?, updated_at = ? WHERE id = ?", ("resolved", "low", "人工確認結案", now_text(), now_text(), incident_id))
            conn.execute("UPDATE DispatchTask SET status = ?, updated_at = ? WHERE incident_id = ?", ("done", now_text(), incident_id))
            add_timeline(conn, incident_id, "resolved", "Manual Close", "Manual confirmed")
            incident = incident_by_id(conn, incident_id)
            send_slack(conn, incident_id, "resolved", slack_message(incident, "resolved"))
        elif action == "reopen":
            team, region = assign_team(incident["station"])
            conn.execute("UPDATE Incident SET status = ?, severity = ?, assignee = ?, assigned_team = ?, region = ?, auto_closed = 0, manual_review_required = 0, updated_at = ? WHERE id = ?", ("assigned", "high", team, team, region, now_text(), incident_id))
            add_timeline(conn, incident_id, "reopen", "Reassigned", f"{region} / {team}")
            incident = incident_by_id(conn, incident_id)
            send_slack(conn, incident_id, "reopen", slack_message(incident, "reopen"))
        elif action == "maintenance_report":
            note = (payload.get("note") or "").strip()
            photo_path = save_report_photo(incident_id, payload.get("photo"))
            review_result, review_confidence, review_summary = run_ai_review(note, photo_path)
            conn.execute("INSERT INTO MaintenanceReport(incident_id, photo_path, result, note, ai_review_result, ai_review_confidence, ai_review_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (incident_id, photo_path, review_result, note, review_result, review_confidence, review_summary, now_text()))
            conn.execute("UPDATE Incident SET status = ?, ai_review_result = ?, ai_review_confidence = ?, ai_review_summary = ?, manual_review_required = ?, updated_at = ? WHERE id = ?", ("waiting_review", review_result, review_confidence, review_summary, 1, now_text(), incident_id))
            add_timeline(conn, incident_id, "maintenance_report", "Team Upload", note or "Completion photo uploaded")
            if review_result == "pass" and review_confidence >= 90:
                conn.execute("UPDATE Incident SET status = ?, severity = ?, auto_closed = 1, manual_review_required = 0, resolved_at = ?, updated_at = ? WHERE id = ?", ("resolved", "low", now_text(), now_text(), incident_id))
                conn.execute("UPDATE DispatchTask SET status = ?, updated_at = ? WHERE incident_id = ?", ("done", now_text(), incident_id))
                add_timeline(conn, incident_id, "ai_review_passed", "AI Review Passed", f"Confidence {review_confidence}%")
                add_timeline(conn, incident_id, "auto_closed", "Incident Auto Closed", "AI review passed")
            else:
                add_timeline(conn, incident_id, "ai_review_pending", "AI Review Needs Manual Check", f"{review_result} / Confidence {review_confidence}%")
            incident = incident_by_id(conn, incident_id)
            send_slack(conn, incident_id, "maintenance_report", slack_message(incident, "maintenance_report", note or review_result))
        else:
            return 400, {"ok": False, "error": "Unknown action"}
    return 200, {"ok": True, "state": project_state()}


def handle_quality_check(payload):
    with connect() as conn:
        photo_id = save_uploaded_photo(conn, payload)
        quality = mock_quality_check(payload)
        conn.execute(
            """
            UPDATE UploadedPhoto
            SET quality_passed = ?, blur_score = ?, is_blur = ?, plate_visible = ?,
                angle_valid = ?, distance_valid = ?
            WHERE photo_id = ?
            """,
            (
                1 if quality["passed"] else 0,
                quality["blurScore"],
                1 if quality["isBlur"] else 0,
                1 if quality["plateVisible"] else 0,
                1 if quality["angleValid"] else 0,
                1 if quality["distanceValid"] else 0,
                photo_id,
            ),
        )
    return 200, {"ok": True, "photoId": photo_id, "quality": quality, "state": project_state()}


def handle_photo_submission(payload):
    photos = payload.get("photos") or []
    with connect() as conn:
        submission_id = next_code(conn, "PhotoSubmission", "submission_id", "SUB")
        submission = {
            "submissionId": submission_id,
            "rentalId": payload.get("rentalId") or "",
            "plate": payload.get("plate") or "",
            "phase": payload.get("phase") or "return",
            "station": payload.get("station") or payload.get("location") or "",
            "parkingLocation": payload.get("parkingLocation") or "",
            "photos": photos,
        }
        ai_results = mock_vehicle_ai_analysis(submission)
        created_incidents = create_incident_from_ai_result(conn, submission, ai_results)
        overall_status = "warning" if created_incidents else "ok"
        status = "incident_created" if created_incidents else "clear"
        ai_summary = (
            f"AI found {len(created_incidents)} issue(s) and created incident(s): {', '.join(created_incidents)}"
            if created_incidents else "AI review found no new damage or cleanliness blocker."
        )
        conn.execute(
            """
            INSERT INTO PhotoSubmission(
              submission_id, rental_id, plate, phase, station, parking_location,
              status, overall_status, ai_summary, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                submission_id,
                submission["rentalId"],
                submission["plate"],
                submission["phase"],
                submission["station"],
                submission["parkingLocation"],
                status,
                overall_status,
                ai_summary,
                now_text(),
            ),
        )
        for photo, ai_result in zip(photos, ai_results):
            photo_payload = {
                "rentalId": submission["rentalId"],
                "plate": submission["plate"],
                "phase": submission["phase"],
                "slot": photo.get("slot") or "front",
                "filename": photo.get("filename") or f"{photo.get('slot') or 'photo'}.jpg",
                "imageData": photo.get("imageData") or photo.get("data") or "",
            }
            photo_id = photo.get("photoId")
            if photo_id:
                cursor = conn.execute(
                    """
                    UPDATE UploadedPhoto
                    SET submission_id = ?, ai_result_json = ?
                    WHERE photo_id = ?
                    """,
                    (submission_id, json.dumps(ai_result, ensure_ascii=False), photo_id),
                )
                if cursor.rowcount == 0:
                    saved_id = save_uploaded_photo(conn, photo_payload, photo_id=photo_id, submission_id=submission_id)
                    conn.execute("UPDATE UploadedPhoto SET ai_result_json = ? WHERE photo_id = ?", (json.dumps(ai_result, ensure_ascii=False), saved_id))
            else:
                saved_id = save_uploaded_photo(conn, photo_payload, submission_id=submission_id)
                conn.execute("UPDATE UploadedPhoto SET ai_result_json = ?, quality_passed = 1 WHERE photo_id = ?", (json.dumps(ai_result, ensure_ascii=False), saved_id))
        if created_incidents:
            message = (
                f"*Photo AI Incident* | {submission['plate']}\n"
                f"Rental: {submission['rentalId']}\n"
                f"Phase: {submission['phase']}\n"
                f"Incidents: {', '.join(created_incidents)}\n"
                f"Dashboard: /irent-ops-dashboard.html"
            )
            send_slack(conn, created_incidents[0], "photo_submission", message)
    return 200, {
        "ok": True,
        "submissionId": submission_id,
        "overallStatus": overall_status,
        "results": ai_results,
        "createdIncidents": created_incidents,
        "state": project_state(),
    }


def get_photo_submissions():
    with connect() as conn:
        rows = conn.execute("SELECT * FROM PhotoSubmission ORDER BY id DESC").fetchall()
        return [row_to_submission(row) for row in rows]


def get_photo_submission_detail(submission_id):
    with connect() as conn:
        row = conn.execute("SELECT * FROM PhotoSubmission WHERE submission_id = ?", (submission_id,)).fetchone()
        if not row:
            return None
        photos = [row_to_photo(photo) for photo in conn.execute("SELECT * FROM UploadedPhoto WHERE submission_id = ? ORDER BY id ASC", (submission_id,))]
        detail = row_to_submission(row)
        detail["photos"] = photos
        return detail


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/state":
            self.send_json(200, project_state())
            return
        if self.path == "/api/submissions":
            self.send_json(200, {"ok": True, "submissions": get_photo_submissions()})
            return
        if self.path.startswith("/api/submissions/"):
            submission_id = self.path.split("/", 3)[-1]
            detail = get_photo_submission_detail(submission_id)
            if not detail:
                self.send_json(404, {"ok": False, "error": "Submission not found"})
                return
            self.send_json(200, {"ok": True, "submission": detail})
            return
        if self.path == "/healthz":
            self.send_json(200, {"ok": True})
            return
        path = self.path.split("?", 1)[0]
        file_path = INDEX_FILE if path in ("", "/") else (ROOT / path.lstrip("/")).resolve()
        if ROOT not in file_path.parents and file_path != ROOT and file_path != INDEX_FILE:
            self.send_error(403)
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return
        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        try:
            payload = self.read_json_body()
        except json.JSONDecodeError:
            self.send_json(400, {"ok": False, "error": "Invalid JSON"})
            return
        if self.path == "/api/incidents":
            with connect() as conn:
                insert_incident(conn, payload, notify=True)
            self.send_json(200, {"ok": True, "state": project_state()})
            return
        if self.path == "/api/action":
            status, body = handle_action(payload)
            self.send_json(status, body)
            return
        if self.path == "/api/photos/quality-check":
            status, body = handle_quality_check(payload)
            self.send_json(status, body)
            return
        if self.path == "/api/photo-submissions":
            status, body = handle_photo_submission(payload)
            self.send_json(status, body)
            return
        if self.path == "/api/settings/slack":
            value = (payload.get("webhook") or "").strip()
            if not value.startswith("https://hooks.slack.com/services/"):
                self.send_json(400, {"ok": False, "error": "Invalid webhook"})
                return
            with connect() as conn:
                set_setting(conn, "slackWebhook", value)
            self.send_json(200, {"ok": True, "state": project_state()})
            return
        self.send_error(404)


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("iRent Ops shared server")
    print(f"Local:   http://127.0.0.1:{PORT}/irent-ops-dashboard.html")
    print(f"Network: http://<this-computer-ip>:{PORT}/irent-ops-dashboard.html")
    server.serve_forever()
