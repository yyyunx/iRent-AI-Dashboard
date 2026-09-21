# iRent 專案架構

```mermaid
flowchart LR
  UI[React + Vite 管理端／驗車端] -->|REST /api| API[Express API]
  API --> Domain[DashboardService：案件、驗車、派工]
  Domain --> Agent[AiAgentService：Google Gemini API]
  Domain --> DB[(SQLite)]
  Domain --> Queue[NotificationService 非同步佇列]
  Queue --> LINE[LINE Messaging API]
  LINE -->|Webhook + HMAC 驗證| API
  API --> Metrics[PerformanceMonitor：平均、P50、P95]
```

## 目錄

- `frontend/src/pages`：角色、管理端儀表板、LINE 通知、AI Agent 與系統設定頁面。
- `frontend/src/context/AppContext.tsx`：管理端共用 API state；僅在可見的 `/operator` 頁面每 15 秒輪詢，並避免重疊請求。使用者頁面不輪詢管理端 state。
- `backend/src/controllers`：HTTP 輸入驗證與回應。
- `backend/src/services`：案件流程、照片檢查（`photo/ScenarioConditionAnalysis.ts` 與既有影像驗證／模型介面）、Google Gemini Agent、LINE 發送佇列與效能量測。
- `backend/src/repositories`：SQLite schema 與資料存取。
- `backend/src/routes`：一般 REST API；LINE Webhook 在 `app.ts` 以 raw body 優先註冊。
- `outputs`：本機 SQLite、上傳圖片與舊版展示檔；runtime DB、uploads、secrets 不由 Git 追蹤。

## 通知設計

- 新的通知寫入 `NotificationLog`，再由最多兩個背景工作者呼叫 LINE；案件 API 不等待外部 LINE 回應。
- LINE 每次最多嘗試兩次，每次呼叫最多四秒；結果和錯誤會寫入通知紀錄與案件 Timeline。
- Channel access token 只讀自環境變數，絕不儲存在 SQLite 或由管理頁回傳。

## 效能觀測

- `GET /api/performance` 回傳最近 200 個 API request 的平均、P50、P95 與錯誤率。
- AI Agent 只透過後端呼叫 Google Gemini API，瀏覽器不會取得 API Key；去敏後的任務摘要仍依既有 Agent history 規則保存。
- `/api/state` 保持既有回應欄位相容；管理端在頁面可見時每 15 秒輪詢，使用者頁面不抓取完整管理端 state。Submission 清單與事件地圖另有 `/api/submissions`、`/api/incidents/map` 專用端點。資料量顯著增加時，應先以實際量測評估相容的摘要或分頁方案。
