# iRent LINE 通知與派工邏輯

## 1. Overview

目前 LINE 是營運通知與案件入口；實際派工由 Dashboard 登入身分及後端 API 決定。

```text
User 上傳六個必填角度 → 品質檢查 → AI 結果保存
→ 提交 Submission → 彙整所有異常 → 最多一個 Incident
→ LINE 群組 Flex Card → Dashboard 登入 → 自領／admin 指定人員
→ 開始處理 → 回報／人工確認 → 結案
```

一次 Submission 可以包含多張異常照片及多個異常項目，仍只產生一個 Incident、一個初始 DispatchTask。沒有已確認異常時不建立 Incident。同一台車下一次 Submission 可以建立新案件，歷史不混在一起。AI 不可用會記錄為 unavailable，不能當成已證實正常。

| LINE 功能 | 現有行為 |
| --- | --- |
| 新案件通知 | 一個 Incident 一張 Flex Card；顯示車號、案件 ID、類型、異常項目／照片數、緊急度、計分原因、提交階段及時間、站點、負責人 |
| 查看案件 | URI 按鈕導向指定 Incident 的 Dashboard |
| 指派給自己 | URI 按鈕導向登入後的確認面板 |
| 指定人員派工 | 導向 Dashboard；admin 選擇有效 operator/admin，再確認 |
| 開始處理 | assigned 卡片提供入口；登入後確認才修改狀態 |
| 狀態同步 | 接單、開始、完工回報、結案、誤報、重開、留言會推播後續進度 |
| 緊急案件提醒 | 緊急度 ≥8、待派工超過預設 10 分鐘，推播一次未接單提醒 |
| 管理及測試 | admin 設定通知目的地、群組名稱、開關，並發送測試訊息 |
| Webhook | 驗證簽章，擷取 user/group/room ID 作為通知目的地 |
| 紀錄與 latency | Dashboard 查看 queued/sending/sent/failed/not_configured；admin 查看 API 與處理階段耗時 |

目前使用一般 Dashboard session 登入，沒有部署 LIFF／LINE Login，也沒有 LINE 帳號與系統帳號 binding。Webhook 不接受聊天指令、postback 自動派工或群組內的人員名單。

## 2. Incident Notification

計分規則集中在 [IncidentUrgency.ts](backend/src/services/IncidentUrgency.ts) 的 `calculateUrgency()`：

| 已確認類型 | 每個項目的權重 |
| --- | ---: |
| dirty | 1 |
| scratch / Scratched | 2 |
| dent / Dented | 3 |
| damage / broken / Broken | 4 |

`totalScore = Σ(權重 × 數量)`，`urgency = min(10, totalScore)`；案件至少有一個異常，分數為 1–10。兩個 scratch 加一個 dent，顯示 `Urgency 7/10 · scratch ×2 (+4) · dent ×1 (+3)`。Dashboard badge 與 LINE 卡片從綠色逐步轉紅色，≥8 加上 High Priority。照片數與異常項目數分開，例如六張照片中的兩張共三個偵測框，即六張照片、兩張異常照片、三個項目。

只採用伺服器保存的確認結果。現有 DamageNet 能辨識 scratch、dent、broken；尚未提供髒污模型推論，dirty 只有在後端保存為已確認髒污時才計分。沒有依刮傷大小、玻璃、輪胎或其他無法辨識的部位加權。舊案件缺少加權資訊時暫以既有 severity 換算，UI 明確標示。

案件與通知 payload／retry key 先保存。Submission、Incident、照片歸屬、重送回應及初始 NotificationLog 在同一 SQLite transaction 中提交，再啟動背景推播。交易回滾不會外送通知。

狀態更新會送出新的進度卡片：`🔵 XXX 已接單` → `🟠 XXX 開始處理` → `✅ 已完成`。同一案件的通知序列依序發送，其他案件可並行；原始卡片仍是當時的快照。點舊卡片時，Dashboard 會取得目前狀態，後端拒絕失效操作。

提醒工作者每 30 秒檢查一次；只處理 `pending_assignment / reopened` 且 urgency ≥8 的案件。門檻由 `LINE_ESCALATION_MINUTES` 設定，以案件建立時間計算，`IncidentEscalation` 保證每個 Incident 最多一次提醒；重開後不重置這個紀錄。通知未設定時不掃描推播。

## 3. Dispatch Actions

卡片使用 [LINE URI action](https://developers.line.biz/en/docs/messaging-api/actions/) 開啟：

```text
/operator/dashboard?incidentId=INC-...                    查看案件
/operator/dashboard?incidentId=INC-...&intent=assign_self 自領確認
/operator/dashboard?incidentId=INC-...&intent=assign      admin 指定人員
/operator/dashboard?incidentId=INC-...&intent=start       開始處理確認
```

登入頁保留原始案件與 intent，登入後返回該頁。GET 連結不修改 DB，使用者需按確認按鈕。群組共用卡片無法依每個閱讀者的角色顯示不同按鈕，因此「指定人員」入口可見，但 operator 登入後只會得到自領操作，指定他人的 API 會回 403。

所有案件操作使用既有 `POST /api/action`，沒有新增 `/incident/:id/assign`：

```json
{
  "action": "dispatch",
  "incidentId": "INC-...",
  "assigneeUserId": 12,
  "expectedVersion": 3
}
```

| action | 用途／可執行狀態 |
| --- | --- |
| assign_self | 待派工、assigned、reopened；身分取 session，不能搶走別人的案件 |
| dispatch + assigneeUserId | admin 指定／重新指定有效人員；僅待派工、assigned、reopened |
| dispatch 不帶人員 | admin 相容既有區域小隊派工；已指定人員的案件不可覆蓋 |
| in_progress | assigned → in_progress；重複開始無新通知，有舊版本時回 409 |
| maintenance_report | 僅 in_progress；保存回報及 AI 複檢，等待人工確認 |
| resolve | in_progress → resolved；不會因 AI 複檢 pass 自動結案 |
| false_positive / reject | admin 人工判定為 false_positive |
| reopen | admin 將 resolved / false_positive → reopened，清空指定人員，重新待派工 |
| comment | 留言及 LINE 通知；operator 僅自己的案件 |

## 4. Assignment Rules

| 操作 | operator | admin |
| --- | --- | --- |
| 查看 Incident／通知紀錄 | ✅ | ✅ |
| Assign Yourself | ✅ 尚未被其他人接手 | ✅ 尚未被其他人接手 |
| Start Processing | ✅ 自己案件 | ✅ |
| Resolve／完工回報 | ✅ 自己案件 | ✅ |
| 指派給其他人／重新指派 | ❌ | ✅ 可派工狀態內 |
| 誤報／重新開案 | ❌ | ✅ |
| 管理設定／通知測試／AI 管理功能 | ❌ | ✅ |

狀態定義集中在 [IncidentLifecycle.ts](backend/src/services/IncidentLifecycle.ts)：

```text
pending_assignment → assigned → in_progress → resolved
pending_assignment / assigned / in_progress / reopened → false_positive
resolved / false_positive → reopened → assigned
```

LINE、Dashboard、DispatchTask 與 API 使用上述狀態值。每次狀態變更保存 `IncidentTimeline` 的 `actor_user_id`、`old_status`、`new_status`、ISO `timestamp`；系統／遷移事件的 actor 為 null，body 標示 system。重新指派同狀態的負責人也有紀錄。AI 複檢需求是 `manual_review_required` 欄位，不另外創造 waiting_review 狀態。

建立 operator 帳號：

```sh
cd backend
npm run create-user -- --username operator01 --role operator
```

執行前以終端機環境變數設定一次性的 USER_INITIAL_PASSWORD，完成後立即清除；CLI 不會互動詢問密碼。既有 admin 保留管理權限，user 只能查看自己的 Submission／相關案件。

## 5. Security / Concurrency

後端 RBAC、session、CSRF 都會驗證。operator 即使手動傳 dispatch、別人的 assigneeUserId 或 user_id，也無法指派其他人；dispatch 回 403，不依賴前端藏按鈕。未登入回 401，非本人 Start／Resolve 回 403。指定人員必須是有效 operator/admin。

自領在 SQLite transaction 內檢查狀態與負責人，再以 `WHERE id = ? AND version = ?` 更新；Incident 與 DispatchTask 一起提交。兩人同時自領，成功一人，其餘 409。Dashboard 寫入時帶 `expectedVersion`；同版本同時 Start／Resolve 只會成功一筆。已 resolved 不能再 start；AI 完工複檢等待期間若案件版本改變，回 409，不能蓋掉新狀態。Agent 派工草稿也保存版本，過期預覽不可覆蓋目前案件。

Submission 可帶 `Idempotency-Key` header 或 `idempotencyKey` body，8–128 個英數、底線、連字號。相同使用者＋相同 key＋相同提交資料回傳原 submissionId／incidentId，`idempotentReplay: true`，不再建案件或推播；同 key 不同資料回 409。未提供 key 時，以 rental、車牌、phase、位置及排序後的 photoId/slot 計算 SHA-256 指紋。重試必須保留原 photoIds 與提交資料；重新上傳照片是另一個請求。

`Incident.source_submission_id` 有 UNIQUE index，DB 本身防止一個 Submission 多張案件。既有每照片一案件資料會合併到最早建立的案件，保留關聯歷史及舊 ID alias，原始資料另存 `IncidentMergeArchive`。

NotificationLog 保存首次 payload、target 及 UUID `X-Line-Retry-Key`，重試沿用相同內容。一般最多兩次嘗試，單次 timeout 4 秒，重試間隔 250 ms；網路／5xx／429 可重試，其餘 4xx 標記 failed。409 只有帶 `x-line-accepted-request-id` 才視為平台已接受。依 [LINE 重試規則](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)，接受推播不等於使用者已讀或一定收到；`sent` 表示平台接受。

queued 及過期 sending 可在重啟後恢復，保留 retry key；每 30 秒亦回收過期 sending。這是單一後端服務的背景佇列，目前沒有多副本分散式 worker lock、人工重送 UI 或 LINE 送達／已讀回執。

## 6. Environment Variables & API Flow

| 設定 | 用途 |
| --- | --- |
| LINE_CHANNEL_ACCESS_TOKEN | Messaging API push token；只在後端環境保存 |
| LINE_CHANNEL_SECRET | webhook 原始 body 的 HMAC-SHA256 簽章驗證 |
| LINE_TARGET_ID | U=user、C=group、R=room 的目的地 ID；環境優先於 Dashboard |
| PUBLIC_DASHBOARD_URL | 公開 HTTPS origin，如 https://your-dashboard.example；有效時產生 Flex＋按鈕，缺少／無效時改純文字 |
| LINE_ESCALATION_MINUTES | 緊急待派工提醒門檻，預設 10 |
| LINE_SENDING_STALE_SECONDS | 重啟／週期回收 sending 的門檻，預設 300，範圍 30–86400 秒 |

詳細 Channel、群組邀請、Webhook 設定見 [LINEBOT_SETUP.md](LINEBOT_SETUP.md)。請指定正式 LINE_TARGET_ID；未設定且 Dashboard 也未保存目的地時，首個驗證通過的 webhook 來源會成為目的地。

| API | 權限／作用 |
| --- | --- |
| POST /api/line/webhook | 不用 session；需有效簽章，無 secret 回 503、無效簽章回 401 |
| POST /api/photo-submissions | 登入＋CSRF；只可提交本人已通過品質檢查的照片 |
| GET /api/state | user 看自己資料；operator/admin 看營運案件與進度 |
| GET /api/operators | admin；有效派工人員列表 |
| POST /api/action | operator/admin＋CSRF，再做操作與案件歸屬檢查 |
| POST /api/settings/line | admin＋CSRF；通知目標、群組名稱、開關 |
| POST /api/notifications/line/test | admin＋CSRF；無設定時保留 not_configured，不宣稱成功 |
| GET /api/performance | admin；API 延遲、分階段延遲、通知統計 |

Dashboard admin 的「處理耗時」顯示 upload_quality_processing、ai_guidance、ai_damage、incident_creation、submission_db_write、submission_processing、line_queue_wait、line_api、submission_to_line_accepted。API 統計保留最近 200 次、stage 統計最近 500 筆，持久化上限 5000 筆。階段包含關係不能直接相加；最後一項從 Submission 處理開始算到 LINE API 接受，不含拍照及先前六張照片上傳／推論。完整本機端點測量及限制見 [API_LATENCY.md](API_LATENCY.md)。

Flex 結構使用 [LINE Flex Message](https://developers.line.biz/en/docs/messaging-api/using-flex-messages/)。核心程式：[NotificationService.ts](backend/src/services/NotificationService.ts)、[DashboardService.ts](backend/src/services/DashboardService.ts)、[DatabaseRepository.ts](backend/src/repositories/DatabaseRepository.ts)。
