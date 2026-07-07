import React, { useState, useEffect } from 'react';
import { useApp, Incident } from '../../context/AppContext';
import { Send, Copy, AlertCircle, HelpCircle, Link2, Sparkles } from 'lucide-react';

const Notifications: React.FC = () => {
  const { state, selectedId, apiPost, showToast } = useApp();

  const [webhookInput, setWebhookInput] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [updatingWebhook, setUpdatingWebhook] = useState(false);

  const incidents = state?.incidents || [];
  const selected = incidents.find(i => i.id === selectedId) || incidents[0];

  const getStatusText = (status: string) => {
    return status === 'assigned' ? 'Auto Dispatch'
      : status === 'waiting_review' ? 'Need Human Review'
      : status === 'resolved' || status === 'done' ? 'Closed'
      : 'AI Detect';
  };

  const getAiMessage = (item: Incident, trigger = 'manual') => {
    if (!item) return '';
    const action = item.type === "damage"
      ? "請客服先比對租前照片與最近租客紀錄，確認是否建立 Inspection Task 或求償流程。"
      : item.type === "cleaning"
        ? "請派最近清潔人員前往處理，完成後回傳照片並更新車輛狀態。"
        : "目前可維持上架營運，系統已保留檢查紀錄供後續追蹤。";

    const headline = item.type === "damage"
      ? "疑似新增車損"
      : item.type === "cleaning"
        ? "車內清潔異常"
        : "車況檢查通過";

    const triggerText = trigger === "auto" ? "AI 自動建立 Incident" : trigger === "dispatch" ? "任務派發更新" : "人工產生通知";
    return [
      `*${headline}* | ${item.plate}`,
      `事件: ${item.label}`,
      `位置: ${item.station}`,
      `AI Confidence: ${item.confidence}%`,
      `Priority Score: ${item.score}`,
      `下一位預約: 約 ${item.nextBooking} 分鐘後`,
      `目前狀態: ${getStatusText(item.status)}`,
      `負責對象: ${item.assignee}`,
      `觸發來源: ${triggerText}`,
      `建議動作: ${action}`
    ].join("\n");
  };

  useEffect(() => {
    if (selected) {
      setCurrentMessage(getAiMessage(selected, 'manual'));
    }
  }, [selected]);

  const handleGenerate = () => {
    if (!selected) return;
    setCurrentMessage(getAiMessage(selected, 'manual'));
    showToast("GenAI 訊息已產生", `${selected.plate} 的 Slack 通知已更新，可直接送出或複製。`);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentMessage);
      showToast("已複製 Slack 訊息", "可貼到 Slack、簡報或測試文件。");
    } catch (error) {
      showToast("複製失敗", "您的瀏覽器不支援剪貼簿寫入，請手動複製文字框內容。");
    }
  };

  const handleUpdateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookInput.trim().startsWith('https://hooks.slack.com/services/')) {
      showToast("網址錯誤", "必須是有效的 https://hooks.slack.com/services/ 連結");
      return;
    }
    setUpdatingWebhook(true);
    try {
      await apiPost('/api/settings/slack', { webhook: webhookInput.trim() });
      setWebhookInput('');
      showToast("設定成功", "Slack Webhook 已更新並啟用");
    } catch (e: any) {
      showToast("設定失敗", e.message);
    } finally {
      setUpdatingWebhook(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-5 items-start">
      {/* Left panel: configure notification */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-5">
        <div className="flex justify-between items-center pb-3 border-b border-irent-line">
          <h2 className="text-lg font-black text-irent-ink m-0">Slack 頻道通知</h2>
          <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">GenAI Message Builder</span>
        </div>

        <div className="border border-[#e4c7eb] rounded-2xl bg-[#fbf5ff] p-3.5 flex flex-col gap-2">
          <strong className="text-[#4a154b] text-sm flex items-center gap-1.5 font-bold">
            <Link2 size={16} />
            Slack 連結狀態: {state?.slackConnected ? '已連接' : '尚未連結'}
          </strong>
          <span className="text-irent-muted text-xs leading-relaxed">
            事件成立後，系統會用 GenAI 產生客服能直接理解的短訊，送到 Slack 頻道。
          </span>
        </div>

        {/* Webhook Form */}
        <form onSubmit={handleUpdateWebhook} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
          <input 
            type="text" 
            placeholder="貼上 Slack Webhook URL 啟用推送" 
            value={webhookInput}
            onChange={e => setWebhookInput(e.target.value)}
            className="w-full h-[42px] border border-irent-line rounded-2xl px-3 text-sm focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
          />
          <button 
            type="submit" 
            disabled={updatingWebhook || !webhookInput.trim()}
            className="h-[42px] px-4 bg-irent-red text-white text-sm font-bold rounded-2xl hover:bg-irent-red-hover transition-all disabled:opacity-50"
          >
            {updatingWebhook ? '設定中...' : '儲存連結'}
          </button>
        </form>

        {selected ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 border-b border-irent-line pb-4">
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">目前事件</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.plate} · {selected.label}</strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">通知對象</span>
                <strong className="text-irent-ink text-xs font-extrabold">{state?.lineGroup || 'iRent Ops Alerts'}</strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">訊息狀態</span>
                <strong className="text-irent-ink text-xs font-extrabold">由 Server 自動通知</strong>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-extrabold text-irent-muted">通知訊息內容 (GenAI 產生)</label>
              <textarea 
                value={currentMessage}
                onChange={e => setCurrentMessage(e.target.value)}
                className="w-full min-h-[270px] resize-y border border-irent-line rounded-2xl p-3 text-xs leading-relaxed font-mono focus:outline-none focus:border-irent-red"
                aria-label="Slack 頻道通知訊息"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button 
                onClick={handleGenerate}
                className="w-full min-h-[44px] rounded-xl bg-irent-red text-white font-extrabold text-xs hover:bg-irent-red-hover hover:shadow-hover transition-all flex items-center justify-center gap-1.5"
              >
                <Sparkles size={14} />
                GenAI 產生訊息
              </button>
              <button 
                onClick={handleCopy}
                className="w-full min-h-[44px] rounded-xl border border-irent-line text-irent-muted bg-white font-extrabold text-xs hover:shadow-hover transition-all flex items-center justify-center gap-1.5"
              >
                <Copy size={14} />
                複製訊息
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-20 text-irent-muted flex flex-col items-center justify-center gap-2">
            <AlertCircle size={40} className="text-irent-line" />
            請選取 Incident 以建立 GenAI 訊息
          </div>
        )}
      </section>

      {/* Right panel: delivery log */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-4">
        <div className="flex justify-between items-center pb-3 border-b border-irent-line">
          <h2 className="text-lg font-black text-irent-ink m-0">通知紀錄</h2>
          <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">Slack Webhook Log</span>
        </div>

        <div className="max-h-[560px] overflow-y-auto flex flex-col gap-2.5">
          {state?.lineLogs && state.lineLogs.length > 0 ? (
            state.lineLogs.map((log, index) => (
              <article key={index} className="border border-irent-line rounded-2xl p-3.5 bg-white flex flex-col gap-1.5">
                <strong className="block text-sm text-irent-ink font-black">{log.title}</strong>
                <span className="text-[11px] text-irent-muted">{log.time} · {log.group}</span>
                <p className="text-xs text-irent-muted whitespace-pre-wrap break-words m-0 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  {log.message}
                </p>
              </article>
            ))
          ) : (
            <div className="text-center py-20 text-irent-muted flex flex-col items-center justify-center gap-2">
              <HelpCircle size={40} className="text-irent-line" />
              目前尚未送出 Slack 通知。
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Notifications;
