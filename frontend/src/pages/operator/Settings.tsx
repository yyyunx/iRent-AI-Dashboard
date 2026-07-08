import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Link2, Sliders, ToggleLeft, ToggleRight } from 'lucide-react';

const Settings: React.FC = () => {
  const { state, apiPost, showToast, developerMode, setDeveloperMode } = useApp();
  const [webhookInput, setWebhookInput] = useState('');
  const [updatingWebhook, setUpdatingWebhook] = useState(false);

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
    } catch (err: any) {
      showToast("設定失敗", err.message);
    } finally {
      setUpdatingWebhook(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Developer Settings Card */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-5">
        <div className="flex justify-between items-center pb-3 border-b border-irent-line">
          <h2 className="text-lg font-black text-irent-ink m-0 flex items-center gap-2">
            <Sliders size={20} className="text-irent-red" />
            開發者模式設定
          </h2>
          <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">DevTools</span>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between p-4 border border-irent-line rounded-2xl bg-[#fafafa]">
            <div className="flex-1 pr-4">
              <strong className="block text-sm text-irent-ink font-bold mb-1">
                啟用前端模糊偵測與指標資訊
              </strong>
              <p className="text-irent-muted text-xs leading-relaxed m-0">
                開啟後，在取車/還車拍照檢查時，將在瀏覽器端使用 Laplacian of Gaussian 算法計算照片的清晰度（Variance of Laplacian）以及推論耗時（Wall Time），並在介面上直接顯示以供調試。
              </p>
            </div>
            <button
              onClick={() => {
                setDeveloperMode(!developerMode);
                showToast(
                  developerMode ? "已關閉開發者模式" : "已開啟開發者模式",
                  developerMode ? "模糊偵測指標已被隱藏" : "現在可在拍照時讀取 Sharpness 與 Wall Time 數據"
                );
              }}
              className="focus:outline-none transition-all duration-200 hover:scale-105 flex-shrink-0"
              aria-label="Toggle Developer Mode"
            >
              {developerMode ? (
                <ToggleRight size={44} className="text-irent-red fill-irent-soft-red" />
              ) : (
                <ToggleLeft size={44} className="text-irent-muted" />
              )}
            </button>
          </div>

          <div className="border border-blue-100 rounded-2xl bg-blue-50/50 p-4 text-xs text-blue-800 leading-relaxed flex flex-col gap-2">
            <strong>💡 Laplacian of Gaussian (LoG) 說明：</strong>
            <ul className="list-disc pl-4 space-y-1">
              <li>圖片在推論前會先等比縮小至 480p（短邊為 480 像素）。</li>
              <li>使用 5x5 高斯卷積核進行降噪，以避免高頻噪點影響判斷。</li>
              <li>使用 3x3 拉普拉斯算子計算邊緣二階導數。</li>
              <li>取拉普拉斯響應的變異數（Variance）作為清晰度分數（Sharpness）。分數越低越模糊，模糊判定閾值預設為 12.0。</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Integration Settings Card */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-5">
        <div className="flex justify-between items-center pb-3 border-b border-irent-line">
          <h2 className="text-lg font-black text-irent-ink m-0 flex items-center gap-2">
            <Link2 size={20} className="text-[#4a154b]" />
            Slack 通訊整合
          </h2>
          <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">Integrations</span>
        </div>

        <div className="border border-[#e4c7eb] rounded-2xl bg-[#fbf5ff] p-4 flex flex-col gap-2">
          <strong className="text-[#4a154b] text-sm flex items-center gap-1.5 font-bold">
            <Link2 size={16} />
            Slack 連結狀態: {state?.slackConnected ? '已連接' : '尚未連結'}
          </strong>
          <span className="text-irent-muted text-xs leading-relaxed">
            設定 Slack Incoming Webhook 網址，當 AI 偵測到車損或清潔異常建立事件時，會即時派送警示短訊。
          </span>
        </div>

        <form onSubmit={handleUpdateWebhook} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 items-center">
          <input
            type="text"
            placeholder="https://hooks.slack.com/services/..."
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

        {state?.slackConnected && (
          <div className="mt-2 p-3.5 border border-irent-line rounded-2xl bg-[#fafafa] text-xs">
            <span className="text-irent-muted block">已設定 Webhook：</span>
            <code className="text-irent-ink font-mono break-all block mt-1 bg-white p-2 rounded-xl border border-slate-100">
              {state?.slackWebhook || '已隱藏/已啟用'}
            </code>
          </div>
        )}
      </section>
    </div>
  );
};

export default Settings;
