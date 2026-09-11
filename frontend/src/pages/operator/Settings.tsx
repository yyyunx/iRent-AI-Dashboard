import React, { useEffect, useState } from 'react';
import { Bot, Eye, EyeOff, KeyRound, Link2, Save, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const Settings: React.FC = () => {
  const { state, apiPost, showToast } = useApp();
  const [targetId, setTargetId] = useState('');
  const [groupName, setGroupName] = useState('iRent Ops Alerts');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [aiModel, setAiModel] = useState('gpt-5-mini');
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingAi, setSavingAi] = useState(false);

  useEffect(() => {
    if (!state?.lineConfig) return;
    setTargetId(state.lineConfig.targetSource === 'environment' ? '' : state.lineConfig.targetId);
    setGroupName(state.lineConfig.groupName);
    setEnabled(state.lineConfig.enabled);
  }, [state?.lineConfig]);

  useEffect(() => {
    if (state?.aiConfig?.model) setAiModel(state.aiConfig.model);
  }, [state?.aiConfig?.model]);

  const saveAi = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingAi(true);
    try {
      await apiPost('/api/settings/ai', { apiKey: apiKey.trim() || undefined, model: aiModel.trim() });
      setApiKey('');
      showToast('AI Agent 設定已儲存', 'API Key 只保留於後端，現在可至營運分析頁提問。');
    } catch (error: any) {
      showToast('AI 設定失敗', error.message);
    } finally {
      setSavingAi(false);
    }
  };

  const clearAiKey = async () => {
    setSavingAi(true);
    try {
      await apiPost('/api/settings/ai', { clearApiKey: true, model: aiModel.trim() });
      setApiKey('');
      showToast('API Key 已移除', 'AI Agent 已停止模型呼叫。');
    } catch (error: any) {
      showToast('移除失敗', error.message);
    } finally {
      setSavingAi(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiPost('/api/settings/line', { targetId: targetId.trim(), groupName: groupName.trim(), enabled });
      showToast('LINE 設定已儲存', '通知會由後端佇列處理，不會阻塞案件操作。');
    } catch (error: any) {
      showToast('設定失敗', error.message);
    } finally {
      setSaving(false);
    }
  };

  const testLine = async () => {
    setTesting(true);
    try {
      const result = await apiPost('/api/notifications/line/test', { message: 'iRent LINE Bot 測試通知：連線設定已接收。' });
      showToast(result.status === 'queued' ? '測試通知已排入佇列' : 'LINE 尚未完成設定', result.status === 'queued' ? '請在通知紀錄確認送達結果。' : '請先設定環境變數 Token 與 Target ID。');
    } catch (error: any) {
      showToast('測試失敗', error.message);
    } finally {
      setTesting(false);
    }
  };

  const config = state?.lineConfig;
  const aiConfig = state?.aiConfig;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] gap-5 items-start">
      <form onSubmit={saveAi} className="xl:col-span-2 bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-irent-line">
          <h2 className="text-lg font-black text-irent-ink flex items-center gap-2"><Bot size={20} className="text-irent-red" /> AI Agent 模型設定</h2>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full self-start ${aiConfig?.keyConfigured ? 'text-[#067b37] bg-[#e9f9ef]' : 'text-amber-800 bg-amber-50'}`}>{aiConfig?.keyConfigured ? 'API Key 已設定' : '尚未設定 API Key'}</span>
        </div>

        <p className="text-sm text-irent-muted leading-relaxed m-0">營運分析頁會由後端呼叫 OpenAI Responses API。Key 不會回傳到瀏覽器；正式部署建議使用 <code>OPENAI_API_KEY</code> 環境變數。</p>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.35fr)] gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-irent-ink">
            OpenAI API Key
            <span className="relative flex items-center">
              <KeyRound size={16} className="absolute left-3 text-irent-muted" />
              <input id="aiApiKey" type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={aiConfig?.keySource === 'environment'} autoComplete="new-password" className="h-11 w-full border border-irent-line rounded-xl pl-10 pr-11 font-mono font-normal disabled:bg-slate-100 focus:outline-none focus:border-irent-red" placeholder={aiConfig?.keyConfigured ? '已設定；留空可保留目前 Key' : 'sk-…'} />
              <button type="button" onClick={() => setShowApiKey(value => !value)} disabled={aiConfig?.keySource === 'environment'} className="absolute right-2 w-8 h-8 grid place-items-center text-irent-muted disabled:opacity-40" aria-label={showApiKey ? '隱藏 API Key' : '顯示 API Key'}>{showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span>
            <small className="font-normal text-xs text-irent-muted">{aiConfig?.keySource === 'environment' ? '目前由 OPENAI_API_KEY 環境變數管理。' : '只會送至本站後端保存；頁面重新載入後不會再次顯示明文。'}</small>
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-bold text-irent-ink">
            模型名稱
            <input id="aiModel" value={aiModel} onChange={event => setAiModel(event.target.value)} className="h-11 border border-irent-line rounded-xl px-3 font-mono font-normal focus:outline-none focus:border-irent-red" placeholder="gpt-5-mini" />
            <small className="font-normal text-xs text-irent-muted">請填入此 API Key 可使用的模型 ID。</small>
          </label>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button type="submit" disabled={savingAi || !aiModel.trim()} className="min-h-[44px] px-4 rounded-xl bg-irent-red text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"><Save size={16} />{savingAi ? '儲存中…' : '儲存 AI 設定'}</button>
          {aiConfig?.keyConfigured && aiConfig.keySource !== 'environment' && <button type="button" onClick={clearAiKey} disabled={savingAi} className="min-h-[44px] px-4 rounded-xl border border-red-200 text-red-700 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"><Trash2 size={16} />移除 API Key</button>}
        </div>
      </form>

      <form onSubmit={save} className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-irent-line">
          <h2 className="text-lg font-black text-irent-ink flex items-center gap-2"><Link2 size={20} className="text-irent-red" /> LINE Bot 通知設定</h2>
          <span className="text-xs font-bold text-[#067b37] bg-[#e9f9ef] px-2.5 py-1 rounded-full">Messaging API</span>
        </div>

        <p className="text-sm text-irent-muted leading-relaxed m-0">Token 只可在部署環境設定，不會經由管理頁或 API 回傳。此頁可設定通知對象與啟用狀態。</p>

        <label className="flex items-center justify-between gap-4 p-4 border border-irent-line rounded-2xl bg-[#fafafa] cursor-pointer">
          <span><strong className="block text-sm text-irent-ink">啟用 LINE 通知</strong><small className="text-xs text-irent-muted">案件建立、派工、回報與結案均會排入發送佇列。</small></span>
          <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="w-5 h-5 accent-irent-red" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-bold text-irent-ink">
          顯示名稱（僅供管理介面辨識）
          <input value={groupName} onChange={event => setGroupName(event.target.value)} maxLength={80} className="h-11 border border-irent-line rounded-xl px-3 font-normal focus:outline-none focus:border-irent-red" placeholder="例如：台北營運群組" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-bold text-irent-ink">
          LINE Target ID
          <input value={targetId} onChange={event => setTargetId(event.target.value)} disabled={config?.targetSource === 'environment'} className="h-11 border border-irent-line rounded-xl px-3 font-mono font-normal disabled:bg-slate-100 focus:outline-none focus:border-irent-red" placeholder="U...、C... 或 R..." />
          <small className="font-normal text-xs text-irent-muted">{config?.targetSource === 'environment' ? '目前由 LINE_TARGET_ID 環境變數管理。' : '可由 LINE webhook 自動帶入，或貼上 webhook event 取得的 userId、groupId、roomId。'}</small>
        </label>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button type="submit" disabled={saving} className="min-h-[44px] px-4 rounded-xl bg-irent-red text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"><Save size={16} />{saving ? '儲存中…' : '儲存設定'}</button>
          <button type="button" onClick={testLine} disabled={testing || !config?.connected} className="min-h-[44px] px-4 rounded-xl border border-red-200 text-irent-red font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"><Send size={16} />{testing ? '送出中…' : '發送測試通知'}</button>
        </div>
      </form>

      <aside className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-4">
        <h2 className="text-lg font-black text-irent-ink flex items-center gap-2"><ShieldCheck size={20} className="text-irent-red" /> 連線狀態</h2>
        <Status label="Channel access token" ok={Boolean(config?.tokenConfigured)} hint="部署環境 LINE_CHANNEL_ACCESS_TOKEN" />
        <Status label="通知目標" ok={Boolean(config?.targetConfigured)} hint={config?.targetId ? `已設定 ${config.targetSource === 'environment' ? '環境變數' : '管理頁'} Target ID` : '尚未取得 userId、groupId 或 roomId'} />
        <Status label="Webhook 簽章" ok={Boolean(config?.webhookConfigured)} hint="部署環境 LINE_CHANNEL_SECRET" />
        <div className={`rounded-2xl p-4 text-sm font-bold ${config?.connected ? 'bg-[#e9f9ef] text-[#067b37]' : 'bg-amber-50 text-amber-800'}`}>{config?.connected ? 'LINE Bot 已可發送通知' : '尚有 LINE 設定未完成'}</div>
        <p className="text-xs text-irent-muted leading-relaxed m-0">新的案件、派工、回報與結案事件皆由 LINE Messaging API 處理。</p>
      </aside>
    </div>
  );
};

const Status: React.FC<{ label: string; ok: boolean; hint: string }> = ({ label, ok, hint }) => (
  <div className="border border-irent-line rounded-xl p-3 flex gap-3 items-start">
    <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-none ${ok ? 'bg-[#16a34a]' : 'bg-amber-400'}`} />
    <span><strong className="block text-sm text-irent-ink">{label}</strong><small className="block text-xs text-irent-muted mt-0.5">{hint}</small></span>
  </div>
);

export default Settings;
