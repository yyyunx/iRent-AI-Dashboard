# API latency 實測與觀測

這份報告覆蓋目前 39 個端點／操作案例，每個 20 次，共 780 次受測請求。測量時間（UTC）：2026-10-04T11:40:52.629Z。

## 測量條件

Windows 本機、隔離 SQLite 資料庫、單一循序 Supertest HTTP client；品質檢查使用 96×96 合成 PNG。數字是本機 request 到 response 的總耗時，包含傳輸、認證、CSRF、middleware、處理與回應；沒有額外 warmup，建置、登入 fixture 與六張照片的準備上傳不計入 Submission 案例。

LINE 停用、Gemini 未設定、DamageNet／KptNet 回應以 stub 模擬。AI 與 LINE 網路／正式推論耗時沒有包含在成功案例數字裡。400／503 案例只測不可用的錯誤路徑，不能推估正常推論耗時。這些結果不代表正式部署或完整使用者驗車到群組收到通知的 latency，也不足以宣稱整個流程一秒內完成。

## 各端點結果

單位 ms，依 P95 由大到小。原始數據保存於 [docs/api-latency-report.json](docs/api-latency-report.json)。

| 端點／操作 | HTTP | 平均 | P50 | P95 | 最大 | 測量限制 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| POST /api/auth/login | 200 | 43.8 | 42.6 | 52.0 | 52.4 | local processing |
| POST /api/photo-submissions | 200 | 11.4 | 9.2 | 19.1 | 37.8 | six saved damage photos; fixture uploads excluded |
| GET /api/state | 200 | 15.8 | 14.9 | 18.6 | 23.6 | local processing |
| POST /api/agent/query | 400 | 13.3 | 12.9 | 15.7 | 16.9 | Gemini unconfigured; error path |
| POST /api/action (maintenance_report) | 200 | 6.1 | 5.1 | 15.1 | 15.3 | LINE disabled; maintenance report has no completion photo |
| GET /uploads/:filename | 200 | 7.8 | 6.0 | 14.6 | 26.7 | local processing |
| POST /api/photos/quality-check | 200 | 9.1 | 9.3 | 10.9 | 11.1 | local processing |
| POST /api/photos/capture-guidance | 200 | 7.3 | 6.8 | 9.6 | 9.9 | AI stub; excludes inference/network |
| POST /api/photos/condition-check | 200 | 8.4 | 8.1 | 9.3 | 10.8 | AI stub; excludes inference/network |
| GET /api/submissions | 200 | 6.4 | 5.8 | 8.6 | 12.0 | local processing |
| POST /api/photos/orientation-check | 503 | 6.5 | 6.1 | 8.6 | 9.2 | orientation unavailable; error path |
| POST /api/auth/logout | 200 | 5.6 | 5.0 | 7.9 | 11.9 | login setup excluded |
| POST /api/settings/line | 200 | 4.6 | 4.1 | 7.4 | 10.4 | local processing |
| POST /api/agent/photo-compare | 400 | 6.6 | 6.6 | 7.4 | 7.5 | Gemini unconfigured; error path |
| POST /api/action (resolve) | 200 | 7.1 | 5.2 | 7.0 | 40.5 | LINE disabled; maintenance report has no completion photo |
| POST /api/agent/audit-query | 200 | 5.8 | 5.4 | 7.0 | 8.6 | local processing |
| POST /api/action (assign_self) | 200 | 6.0 | 5.6 | 6.6 | 13.2 | LINE disabled; maintenance report has no completion photo |
| GET /api/performance | 200 | 5.3 | 5.2 | 6.3 | 6.8 | local processing |
| POST /api/action (reopen) | 200 | 5.3 | 5.1 | 6.1 | 7.4 | LINE disabled; maintenance report has no completion photo |
| GET /healthz | 200 | 5.3 | 4.0 | 5.9 | 28.2 | local processing |
| POST /api/action (in_progress) | 200 | 4.9 | 4.8 | 5.9 | 6.0 | LINE disabled; maintenance report has no completion photo |
| POST /api/action (comment) | 200 | 4.8 | 4.3 | 5.8 | 10.1 | LINE disabled; maintenance report has no completion photo |
| GET /api/submissions/:submissionId | 200 | 5.2 | 4.8 | 5.7 | 9.1 | local processing |
| POST /api/action (dispatch) | 200 | 4.9 | 4.9 | 5.6 | 5.9 | LINE disabled; maintenance report has no completion photo |
| POST /api/action (specified operator) | 200 | 5.8 | 5.0 | 5.6 | 20.1 | LINE disabled |
| GET /api/agent/operations | 200 | 5.0 | 4.8 | 5.5 | 9.2 | local processing |
| GET /api/incidents/map | 200 | 4.7 | 4.3 | 5.4 | 9.6 | local processing |
| POST /api/agent/action-drafts/:draftId/confirm | 200 | 4.6 | 4.5 | 5.3 | 5.5 | LINE disabled; draft setup excluded |
| POST /api/line/webhook | 200 | 3.7 | 3.3 | 5.1 | 7.7 | local processing |
| POST /api/agent/sop-query | 200 | 4.2 | 3.8 | 5.0 | 7.6 | local processing |
| POST /api/notifications/line/test | 200 | 3.9 | 3.8 | 4.9 | 5.0 | not_configured; no LINE push |
| POST /api/agent/dispatch-drafts | 200 | 4.2 | 4.1 | 4.8 | 5.0 | local draft generation |
| POST /api/incidents | 200 | 4.3 | 4.0 | 4.7 | 9.0 | local processing |
| GET /api/auth/csrf | 200 | 3.6 | 3.4 | 4.4 | 5.6 | local processing |
| POST /api/settings/ai | 200 | 4.0 | 3.9 | 4.4 | 4.6 | local processing |
| POST /api/agent/line-drafts | 200 | 4.1 | 4.0 | 4.4 | 4.7 | local draft generation |
| GET /api/auth/me | 200 | 3.2 | 3.1 | 3.9 | 4.2 | local processing |
| GET /api/operators | 200 | 3.4 | 3.3 | 3.7 | 3.8 | local processing |
| GET /api/agent/history | 200 | 3.4 | 3.2 | 3.4 | 6.1 | local processing |

## 執行與判讀

```sh
cd backend
npm run benchmark:api -- ../outputs/api-latency-report.json
```

Benchmark 不讀 runtime .env，建立臨時 DB／上傳目錄，停用外部服務，結束後移除該次臨時 fixture。請保留 production 的資料及設定。

登入使用 Argon2id，耗時通常較一般 DB 操作高。GET /api/state 會包含案件、timeline、照片及通知資料，資料量增加會影響成本；這次測量只有少量 fixture，沒有模擬大量案件、多 client 同時操作或正式網路延遲。高流量需求應另外做併發及資料量壓力測試。

## Dashboard 即時觀測

Admin Dashboard 的「處理耗時」每 15 秒讀取 GET /api/performance，可展開各端點平均／P95／錯誤率。API 統計保留最近 200 次，程序重啟會歸零；分階段樣本保存到 SQLite，保留 5000 筆，回傳最近 500 筆。P95 在小樣本時接近最大值；沒有樣本代表尚未量到，不代表零毫秒。

| stage | 起訖與範圍 |
| --- | --- |
| upload_quality_processing | 進入品質檢查處理後，到解碼、檢查、存檔及照片 DB 寫入；不含完整手機上傳網路時間 |
| ai_guidance | 後端呼叫拍攝導引 adapter 的時間，包含實際運行時的外部等待 |
| ai_damage | 後端呼叫車損 adapter 的時間，包含實際運行時的外部等待 |
| incident_creation | 彙整異常、建立 Incident／DispatchTask／timeline |
| submission_db_write | Submission 與照片關聯寫入 |
| submission_processing | Submission 處理總計；包含 Incident 建立及 DB 寫入，不能與這兩項重複相加 |
| line_queue_wait | 通知等待背景 worker 的時間 |
| line_api | 每次 LINE push 嘗試的時間；錯誤嘗試亦保留 |
| submission_to_line_accepted | Submission 開始處理到初始 LINE 通知被平台接受；包含排隊、重試及等待，不含先前拍照、上傳或 AI 檢查 |

正式端到端數字要在實際部署、模型服務與 LINE 設定完成後，由 submission trace 觀察；sent 只表示 LINE API 接受。各階段有包含關係及不同 trace（photoId/submissionId），不能把平均值直接相加當成一趟驗車時間。

LINE 設定與操作規則見 [LINE_README.md](LINE_README.md)。
