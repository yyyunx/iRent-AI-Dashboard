import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BrainCircuit, Clock3, Route, ShieldAlert } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface AgentOperations {
  generatedAt: string;
  shiftBriefing: {
    activeIncidents: number;
    highRiskIncidents: number;
    bookingRiskIncidents: number;
    overdueIncidents: number;
    pendingMaintenance: number;
    lineNotificationsNeedingAttention: number;
  };
  slaAlerts: Array<{
    incidentId: string;
    plate: string;
    urgency: 'critical' | 'warning';
    ageMinutes: number;
    nextBookingMinutes: number;
    reasons: string[];
  }>;
  dispatchDraft: Array<{
    incidentId: string;
    plate: string;
    station: string;
    score: number;
    recommendedTeam: string;
    reason: string;
  }>;
  clusters: Array<{ dimension: string; key: string; count: number; evidence: string }>;
}

interface AgentTask {
  id: number;
  promptSummary: string;
  resultSummary: string;
  model: string | null;
  status: 'completed' | 'failed';
  username: string | null;
  createdAt: string;
}

const AgentOperationsPanel: React.FC = () => {
  const { apiPost, showToast } = useApp();
  const [operations, setOperations] = useState<AgentOperations | null>(null);
  const [history, setHistory] = useState<AgentTask[]>([]);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { id: string; type: 'dispatch' | 'line'; incidentId: string; preview: any }>>({});
  const [busyKey, setBusyKey] = useState('');

  const createDraft = async (type: 'dispatch' | 'line', incidentId: string) => {
    const key = `${type}:${incidentId}`;
    setBusyKey(key);
    try {
      const result = await apiPost(type === 'dispatch' ? '/api/agent/dispatch-drafts' : '/api/agent/line-drafts', {
        incidentId,
        ...(type === 'line' ? { style: 'urgent' } : {})
      });
      setDrafts(items => ({ ...items, [key]: result.draft }));
    } finally {
      setBusyKey('');
    }
  };

  const confirmDraft = async (draft: { id: string; type: 'dispatch' | 'line'; incidentId: string }) => {
    const label = draft.type === 'dispatch' ? '執行派工' : '將 LINE 訊息加入發送佇列';
    if (!window.confirm(`請再次確認：${label}？後端會重新驗證案件狀態。`)) return;
    const key = `${draft.type}:${draft.incidentId}`;
    setBusyKey(key);
    try {
      await apiPost(`/api/agent/action-drafts/${encodeURIComponent(draft.id)}/confirm`, {});
      setDrafts(items => Object.fromEntries(Object.entries(items).filter(([itemKey]) => itemKey !== key)));
      showToast('已完成管理員確認', draft.type === 'dispatch' ? '派工已執行。' : 'LINE 通知已送入佇列。');
      await load();
    } finally {
      setBusyKey('');
    }
  };

  const load = useCallback(async () => {
    try {
      const [operationsResponse, historyResponse] = await Promise.all([
        fetch('/api/agent/operations', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/agent/history?limit=6', { credentials: 'include', cache: 'no-store' })
      ]);
      if (!operationsResponse.ok || !historyResponse.ok) throw new Error('Agent operations request failed');
      const [operationsData, historyData] = await Promise.all([operationsResponse.json(), historyResponse.json()]);
      setOperations(operationsData.operations);
      setHistory(historyData.history);
      setError('');
    } catch {
      setError('無法載入 Agent 營運摘要。');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (error) return <div className="inline-error"><AlertTriangle size={15} />{error}</div>;
  if (!operations) return <section className="agent-operations agent-operations--loading">正在整理交班與 SLA 資料…</section>;

  const briefing = operations.shiftBriefing;
  return (
    <section className="agent-operations" aria-label="Agent 營運決策支援">
      <header><div><span className="eyebrow">RULE-BASED OPERATIONS</span><h2>交班摘要與決策草稿</h2></div><small>僅提供建議，不會直接執行派工</small></header>
      <div className="agent-operations__briefing">
        <article><BrainCircuit size={18} /><b>{briefing.activeIncidents}</b><span>未結案件</span></article>
        <article><ShieldAlert size={18} /><b>{briefing.highRiskIncidents}</b><span>高風險</span></article>
        <article><Clock3 size={18} /><b>{briefing.overdueIncidents}</b><span>SLA 逾時</span></article>
        <article><Route size={18} /><b>{briefing.bookingRiskIncidents}</b><span>預約風險</span></article>
      </div>
      <div className="agent-operations__grid">
        <section><h3>SLA 預警</h3>{operations.slaAlerts.length ? operations.slaAlerts.slice(0, 5).map(item => <div className={`agent-operation-row is-${item.urgency}`} key={item.incidentId}><strong>{item.plate}</strong><span>{item.reasons.join('、')}</span><small>{item.incidentId}</small></div>) : <p>目前沒有逾時或近期預約風險。</p>}</section>
        <section><h3>派工與 LINE 草稿</h3>{operations.dispatchDraft.length ? operations.dispatchDraft.slice(0, 5).map(item => {
          const dispatchDraft = drafts[`dispatch:${item.incidentId}`];
          const lineDraft = drafts[`line:${item.incidentId}`];
          return <div className="agent-operation-row agent-operation-row--actions" key={item.incidentId}><strong>{item.recommendedTeam}</strong><span>{item.plate} · {item.station} · {item.reason}{lineDraft && <em>{lineDraft.preview.message}</em>}</span><span className="agent-draft-actions">{dispatchDraft ? <button type="button" disabled={busyKey !== ''} onClick={() => void confirmDraft(dispatchDraft)}>確認派工</button> : <button type="button" disabled={busyKey !== ''} onClick={() => void createDraft('dispatch', item.incidentId)}>派工草稿</button>}{lineDraft ? <button type="button" disabled={busyKey !== ''} onClick={() => void confirmDraft(lineDraft)}>確認 LINE</button> : <button type="button" disabled={busyKey !== ''} onClick={() => void createDraft('line', item.incidentId)}>LINE 草稿</button>}</span></div>;
        }) : <p>目前沒有待派工案件。</p>}</section>
        <section><h3>群聚證據</h3>{operations.clusters.length ? operations.clusters.slice(0, 5).map(item => <div className="agent-operation-row" key={`${item.dimension}-${item.key}`}><strong>{item.key}</strong><span>{item.evidence}</span><small>{item.dimension}</small></div>) : <p>目前資料不足以形成群聚。</p>}</section>
      </div>
      <div className="agent-operations__history"><h3>持久化 Agent 任務歷史</h3>{history.length ? history.map(item => <article key={item.id}><time>{new Date(item.createdAt).toLocaleString('zh-TW')}</time><strong>{item.promptSummary}</strong><span>{item.status === 'completed' ? item.resultSummary : '執行失敗（已記錄，不含敏感內容）'}</span></article>) : <p>尚無 Agent 查詢紀錄。</p>}</div>
    </section>
  );
};

export default AgentOperationsPanel;
