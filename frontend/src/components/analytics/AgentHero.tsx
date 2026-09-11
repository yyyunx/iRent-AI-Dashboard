import React, { useEffect, useState } from 'react';
import { Bot, Check, Clock3, Send, Sparkles } from 'lucide-react';
import { AppState } from '../../context/AppContext';

interface AgentHeroProps {
  state: AppState | null;
  onOpenTasks: () => void;
  requestedCommand?: { id: number; prompt: string } | null;
}

interface AgentAnswer {
  title: string;
  insight: string;
  recommendation: string;
  evidence: string;
}

const PROMPTS = [
  '分析近 30 天車損熱點與預防保養建議',
  '依目前 Incident 建議優先派工順序',
  '盤點目前高風險事件',
  '生成今日車隊維護效率與時間節省摘要'
];

const AgentHero: React.FC<AgentHeroProps> = ({ state, onOpenTasks, requestedCommand }) => {
  const [query, setQuery] = useState('');
  const [thinking, setThinking] = useState(false);
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [history, setHistory] = useState<{ query: string; time: string }[]>([]);

  const analyze = (raw: string) => {
    const prompt = raw.trim();
    if (!prompt || thinking) return;
    setQuery(prompt);
    setThinking(true);
    setAnswer(null);

    window.setTimeout(() => {
      const incidents = state?.incidents || [];
      const active = incidents.filter(item => !['resolved', 'done'].includes(item.status));
      const high = active.filter(item => item.severity === 'high').sort((a, b) => b.score - a.score);
      const hotspot = state?.damageHotspots?.[0];
      let result: AgentAnswer;

      if (/熱區|車損|保養/.test(prompt)) {
        result = hotspot ? {
          title: '近 30 天車損熱點分析',
          insight: `${hotspot[0]} 是目前事件數最高的車損位置，共 ${hotspot[1]} 次。`,
          recommendation: `優先檢視與 ${hotspot[0]} 相關的驗車照片，並把重複發生事件納入預防檢查清單。`,
          evidence: `依據 damageHotspots 共 ${state?.damageHotspots?.length || 0} 個位置的現有統計。`
        } : { title: '車損熱點分析', insight: '目前尚無近 30 天車損熱點資料。', recommendation: '等待更多 Incident 累積後再執行分析。', evidence: '資料不足，未產生預測。' };
      } else if (/派工|順序/.test(prompt)) {
        const priority = high[0] || active.sort((a, b) => b.score - a.score)[0];
        result = priority ? {
          title: 'Agent 優先派工建議', insight: `${priority.plate}／${priority.station} 的 Priority Score 為 ${priority.score}，是目前優先處理項目。`,
          recommendation: `建議先處理「${priority.label}」，再依分數由高至低檢視其餘 ${Math.max(0, active.length - 1)} 件待辦。`,
          evidence: `依據 ${active.length} 件未完成 Incident 的 score、嚴重度與下一筆預約排序。`
        } : { title: 'Agent 優先派工建議', insight: '目前沒有待處理 Incident。', recommendation: '維持即時監控即可。', evidence: '現有待辦數為 0。' };
      } else if (/高風險|風險/.test(prompt)) {
        result = { title: '即時風險盤點', insight: `目前有 ${high.length} 件高優先 Incident，全部未完成事件共 ${active.length} 件。`, recommendation: high.length ? `先檢視 ${high.slice(0, 3).map(item => item.plate).join('、')}。` : '目前沒有高優先事件。', evidence: '依據 incidents 的 severity、status 與 priority score 即時計算。' };
      } else {
        result = { title: '今日營運摘要', insight: `目前共 ${incidents.length} 件 Incident，未完成 ${active.length} 件，自動結案率 ${state?.opsMetrics?.autoCloseRate || '0%'}。`, recommendation: active.length ? '持續依 Priority Score 處理未完成事件，並追蹤 AI Review 結果。' : '目前無待辦，可持續監控新送件。', evidence: `後端估算時間節省為 ${state?.opsMetrics?.avgTimeSaved || '0分'}。` };
      }

      setAnswer(result);
      setHistory(items => [{ query: prompt, time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) }, ...items].slice(0, 4));
      setThinking(false);
    }, 520);
  };

  useEffect(() => {
    if (requestedCommand) analyze(requestedCommand.prompt);
    // The command id intentionally triggers one analysis using the latest state snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedCommand?.id]);

  return (
    <section className="agent-hero">
      <div className="agent-hero__status"><span /><strong>Agent 運作中</strong><small>即時監控・數據分析・營運建議</small></div>
      <div className="agent-hero__copy"><span className="eyebrow">AI FOR A SAFER, SMARTER TOMORROW</span><h1>iRent AI Operations Copilot</h1><p>用 AI 洞察驅動營運，從分析到行動，讓每一台車都在對的地方、為對的人服務。</p></div>
      <div className="agent-capabilities"><span>預測風險異常</span><span>智能派工建議</span><span>即時車隊監控</span><span>生成營運洞察</span></div>

      <form className="agent-command" onSubmit={event => { event.preventDefault(); analyze(query); }}>
        <Bot size={22} />
        <label className="sr-only" htmlFor="agentQuery">向 iRent AI Agent 提問</label>
        <input id="agentQuery" value={query} onChange={event => setQuery(event.target.value)} placeholder="向 iRent AI 提問，例如：分析近期事故原因，或建議優先派工順序？" />
        <button type="submit" disabled={thinking || !query.trim()}><Send size={16} />送出</button>
      </form>
      <div className="agent-prompts" aria-label="建議分析指令">{PROMPTS.map(prompt => <button type="button" key={prompt} onClick={() => { setQuery(prompt); analyze(prompt); }}><Sparkles size={12} />{prompt}</button>)}</div>

      {thinking && <div className="agent-thinking"><span className="agent-pulse"><Bot size={17} /></span><div><strong>AI Agent 正在分析…</strong><p><span><Check size={12} />讀取車隊狀態</span><span><Check size={12} />分析 Incident 與熱點</span><span className="active"><Clock3 size={12} />產生營運建議</span></p></div></div>}

      {answer && <article className="agent-answer"><header><span><Bot size={17} /></span><div><small>AI AGENT 洞察與建議</small><h2>{answer.title}</h2></div></header><div className="agent-answer__grid"><section><b>Insight</b><p>{answer.insight}</p></section><section><b>Recommendation</b><p>{answer.recommendation}</p></section><section><b>Data basis</b><p>{answer.evidence}</p></section></div>{/派工/.test(answer.title) && <button type="button" onClick={onOpenTasks}>查看任務派發 →</button>}</article>}

      {history.length > 0 && <div className="agent-history"><strong>最近 Agent 任務</strong>{history.map((item, index) => <span key={`${item.time}-${index}`}><time>{item.time}</time>{item.query}</span>)}</div>}
    </section>
  );
};

export default AgentHero;
