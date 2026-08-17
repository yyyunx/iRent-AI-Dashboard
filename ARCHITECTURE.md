# iRent 專案架構

```mermaid
flowchart LR
  UI[React + Vite 管理端／驗車端] -->|REST /api| API[Express API]
  API --> Domain[DashboardService：案件、驗車、派工]
  Domain --> DB[(SQLite)]
  Domain --> Queue[NotificationService 非同步佇列]
  Queue --> LINE[LINE Messaging API]
  LINE -->|Webhook + HMAC 驗證| API
  API --> Metrics[PerformanceMonitor：平均、P50、P95]
```

## 目錄

- `frontend/src/pages`：角色、管理端儀表板、LINE 通知與 ROI 頁面。
- `frontend/src/context/AppContext.tsx`：共用 API state 與三秒輪詢。
- `backend/src/controllers`：HTTP 輸入驗證與回應。
- `backend/src/services`：案件流程、LINE 發送佇列、效能量測。
- `backend/src/repositories`：SQLite schema 與資料存取。
- `backend/src/routes`：一般 REST API；LINE Webhook 在 `app.ts` 以 raw body 優先註冊。
- `outputs`：SQLite、上傳圖片與舊版展示檔；不屬於新的前後端程式碼。

## 通知設計

- 舊 `SlackNotification`、Slack 設定 API 與歷史資料保留，避免既有資料／呼叫端失效。
- 新的通知寫入 `NotificationLog`，再由最多兩個背景工作者呼叫 LINE；案件 API 不等待外部 LINE 回應。
- LINE 每次最多嘗試兩次，每次呼叫最多四秒；結果和錯誤會寫入通知紀錄與案件 Timeline。
- Channel access token 只讀自環境變數，絕不儲存在 SQLite 或由管理頁回傳。

## 效能觀測

- `GET /api/performance` 回傳最近 200 個 API request 的平均、P50、P95 與錯誤率。
- 管理端可先開啟 ROI 試算頁做商業效益估算；部署後以效能端點驗證實際延遲。
- 目前 state 輪詢間隔為三秒。資料量顯著增加時，應改成摘要 API、分頁與 Server-Sent Events／WebSocket。
