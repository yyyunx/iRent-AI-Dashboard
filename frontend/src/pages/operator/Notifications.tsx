import React from 'react';
import { BellRing, CircleAlert, Clock3, ExternalLink, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

const Notifications: React.FC = () => {
  const { state, apiPost, showToast } = useApp();
  const navigate = useNavigate();
  const logs = state?.lineLogs || [];
  const connected = state?.lineConfig?.connected;

  const test = async () => {
    try {
      const result = await apiPost('/api/notifications/line/test', { message: 'iRent LINE Bot 測試通知：連線設定已接收。' });
      showToast(result.status === 'queued' ? '測試通知已排入佇列' : 'LINE 尚未完成設定', result.status === 'queued' ? '系統會在背景送達。' : '請至設定頁完成 Token 與 Target ID。');
    } catch (error: any) {
      showToast('測試失敗', error.message);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)] gap-5 items-start">
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-5">
        <div className="flex items-center gap-2 pb-3 border-b border-irent-line"><BellRing size={20} className="text-irent-red" /><h2 className="text-lg font-black text-irent-ink">LINE Bot 通知</h2></div>
        <div className={`p-4 rounded-2xl ${connected ? 'bg-[#e9f9ef]' : 'bg-amber-50'}`}>
          <strong className={`block text-sm ${connected ? 'text-[#067b37]' : 'text-amber-800'}`}>{connected ? 'LINE Messaging API 已就緒' : 'LINE 尚未完成連線'}</strong>
          <span className="block text-xs text-irent-muted leading-relaxed mt-1">通知會先記錄為 queued，再由最多兩個背景工作者發送並重試一次。</span>
        </div>
        <button onClick={test} disabled={!connected} className="min-h-[44px] rounded-xl bg-irent-red text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"><Send size={16} />發送測試通知</button>
        <button onClick={() => navigate('/operator/settings')} className="min-h-[44px] rounded-xl border border-irent-line text-irent-muted font-bold text-sm flex items-center justify-center gap-2"><ExternalLink size={16} />管理 LINE 設定</button>
        <p className="text-xs text-irent-muted leading-relaxed m-0">所有新案件事件皆由 LINE Bot 發送，狀態與錯誤會保留在通知紀錄。</p>
      </section>

      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-4">
        <div className="flex justify-between items-center gap-3 pb-3 border-b border-irent-line"><h2 className="text-lg font-black text-irent-ink">LINE 發送紀錄</h2><span className="text-xs font-bold text-[#067b37] bg-[#e9f9ef] px-2.5 py-1 rounded-full">{logs.length} 筆</span></div>
        <div className="max-h-[620px] overflow-y-auto flex flex-col gap-2.5">
          {logs.length ? logs.map((log, index) => <article key={index} className="border border-irent-line rounded-2xl p-3.5 flex flex-col gap-2"><div className="flex justify-between gap-3"><strong className="text-sm text-irent-ink">{log.title}</strong><Status status={log.status} /></div><span className="text-xs text-irent-muted flex items-center gap-1"><Clock3 size={13} />{log.time} · {log.group}</span><p className="text-xs text-irent-muted whitespace-pre-wrap break-words m-0 bg-slate-50 p-2.5 rounded-xl">{log.message}</p>{log.error && <p className="text-xs text-red-700 flex gap-1.5 m-0"><CircleAlert size={14} className="flex-none" />{log.error}</p>}</article>) : <div className="py-20 text-center text-irent-muted text-sm">尚無 LINE 通知紀錄。</div>}
        </div>
      </section>
    </div>
  );
};

const Status: React.FC<{ status: string }> = ({ status }) => {
  const classes: Record<string, string> = { sent: 'bg-[#e9f9ef] text-[#067b37]', queued: 'bg-blue-50 text-blue-700', sending: 'bg-blue-50 text-blue-700', failed: 'bg-red-50 text-red-700', not_configured: 'bg-amber-50 text-amber-800' };
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${classes[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span>;
};

export default Notifications;
