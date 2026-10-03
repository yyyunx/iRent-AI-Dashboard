# 串接 iRent LINE Bot

本專案使用 **LINE Official Account 的 Messaging API**。請勿使用已停止服務的 LINE Notify。

## 1. 在 LINE 建立 Channel

1. 在 [LINE Developers Console](https://developers.line.biz/console/) 建立 Provider，新增 **Messaging API channel**，並綁定／建立 Official Account。
2. 在 Channel 的 **Messaging API** 分頁發行長效 `Channel access token`。
3. 在 **Basic settings** 取得 `Channel secret`。
4. 於 Official Account Manager 關閉不需要的自動回覆；需要雙向互動時再開啟 webhook。

## 2. 設定部署環境變數

在 Render 或本機 `.env` 設定，請勿提交 token：

```env
LINE_CHANNEL_ACCESS_TOKEN=你的長效ChannelAccessToken
LINE_CHANNEL_SECRET=你的ChannelSecret
# 可選。若未設定，可透過 webhook 自動取得第一個來源的 ID，或由管理頁填入。
LINE_TARGET_ID=
```

`LINE_TARGET_ID` 必須是 webhook event 裡的 `userId`（U 開頭）、`groupId`（C 開頭）或 `roomId`（R 開頭），不是使用者或群組顯示名稱。環境變數優先於管理頁設定。

## 3. 取得通知對象 ID

### 個人

1. 將 Official Account 加為好友。
2. 在 LINE Developers Console 開啟 **Use webhook**。
3. 設定 webhook URL 為 `https://你的網域/api/line/webhook`，並按 Verify。
4. 從該帳號傳一則訊息；系統會驗證簽章並記住事件來源的 user ID（若尚未設定 Target ID）。

### 群組

1. 在 Channel 的 **Messaging API** 分頁開啟 **Allow bot to join group chats**。
2. 把 Official Account 邀入目標群組。
3. 在群組傳一則訊息，產生 group message webhook event。
4. 系統驗證 `x-line-signature` 後，從 `event.source.groupId` 取得 ID。開發環境會輸出 `[LINE] groupId: Cxxxxxxxx`；Docker 可用 `docker compose logs -f web` 查看。
5. 確認後到管理端「LINE Bot 通知設定」檢查／儲存。

> 正式環境建議直接在 Render 設定 `LINE_TARGET_ID`，避免第一個 webhook 來源意外成為通知對象。

## 4. 驗證與測試

1. 重新部署後開啟管理端「LINE Bot 通知設定」。三個狀態（token、通知目標、webhook 簽章）應為完成。
2. 按「發送測試通知」。管理端會先顯示 `queued`，之後在「LINE 通知」查看 `sent` 或 `failed`。
3. 建立／派工／更新案件，確認會留下 `line_sent` 或 `line_failed` Timeline。

## Webhook 與安全性

- `/api/line/webhook` 以原始 request body 配合 `x-line-signature` 的 HMAC-SHA256 驗證；無效簽章回應 401。
- 未設定 `LINE_CHANNEL_SECRET` 時回應 503，避免未驗證的 webhook 被接收。
- LINE Developers Console 必須填可公開存取的 HTTPS URL，例如 `https://你的網域/api/line/webhook`；`localhost` 無法接收 LINE 平台送出的 webhook。
- Token 不經過前端、不進資料庫、不寫入 log。
- LINE API 發送最多重試一次，單次 timeout 為 4 秒，但在背景佇列執行，因此不增加案件操作的 API latency。
