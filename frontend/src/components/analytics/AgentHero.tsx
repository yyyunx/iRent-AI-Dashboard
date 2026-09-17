import React, { useEffect, useState } from 'react';
import { Bot, Check, Clock3, Send, Settings, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppState, useApp } from '../../context/AppContext';

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

type AgentMode = 'operations' | 'sop' | 'audit';

const PROMPTS: Array<{ text: string; mode: AgentMode }> = [
  { text: '分析近 30 天車損熱點與預防保養建議', mode: 'operations' },
  { text: '依目前 Incident 建議優先派工順序', mode: 'operations' },
  { text: 'SOP：這個維修案件下一步該做什麼？', mode: 'sop' },
  { text: 'Audit：今天誰 reopen 過案件？', mode: 'audit' }
];

const AgentHero: React.FC<AgentHeroProps> = ({ state, onOpenTasks, requestedCommand }) => {
  const navigate = useNavigate();
  const { apiPost } = useApp();
  const [query, setQuery] = useState('');
  const [thinking, setThinking] = useState(false);
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [error, setError] = useState('');
  const [answerModel, setAnswerModel] = useState('');
  const [history, setHistory] = useState<{ query: string; time: string }[]>([]);

  const analyze = async (raw: string, mode: AgentMode = 'operations') => {
    const prompt = raw.trim();
    if (!prompt || thinking) return;
    setQuery(prompt);
    setThinking(true);
    setAnswer(null);
    setError('');
    try {
      const endpoint = mode === 'sop' ? '/api/agent/sop-query' : mode === 'audit' ? '/api/agent/audit-query' : '/api/agent/query';
      const result = await apiPost(endpoint, { prompt });
      setAnswer(result.answer);
      setAnswerModel(result.model || state?.aiConfig?.model || 'Google Gemini');
      setHistory(items => [{ query: prompt, time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) }, ...items].slice(0, 4));
    } catch (requestError: any) {
      setError(requestError.message || 'AI Agent 暫時無法回應。');
    } finally {
      setThinking(false);
    }
  };

  useEffect(() => {
    if (requestedCommand) analyze(requestedCommand.prompt);
    // The command id intentionally triggers one analysis using the latest state snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedCommand?.id]);

  return (
    <section className="agent-hero">
      <div className="agent-hero__status"><span className={state?.aiConfig?.keyConfigured ? '' : 'is-offline'} /><strong>{state?.aiConfig?.keyConfigured ? 'Agent 已連線' : 'Agent 等待設定'}</strong><small>{state?.aiConfig?.keyConfigured ? `${state.aiConfig.model}・即時營運分析` : '請至系統設定填入 Google Gemini API Key'}</small></div>
      <div className="agent-hero__copy"><span className="eyebrow">AI FOR A SAFER, SMARTER TOMORROW</span><h1>iRent AI Operations Copilot</h1><p>用 AI 洞察驅動營運，從分析到行動，讓每一台車都在對的地方、為對的人服務。</p></div>
      <div className="agent-capabilities"><span>即時風險分析</span><span>智能派工建議</span><span>即時車隊監控</span><span>生成營運洞察</span></div>

      <form className="agent-command" onSubmit={event => { event.preventDefault(); analyze(query); }}>
        <Bot size={22} />
        <label className="sr-only" htmlFor="agentQuery">向 iRent AI Agent 提問</label>
        <input id="agentQuery" value={query} onChange={event => setQuery(event.target.value)} placeholder="向 iRent AI 提問，例如：分析近期事故原因，或建議優先派工順序？" />
        <button type="submit" disabled={thinking || !query.trim()}><Send size={16} />送出</button>
      </form>
      <div className="agent-prompts" aria-label="建議分析指令">{PROMPTS.map(prompt => <button type="button" key={prompt.text} onClick={() => { setQuery(prompt.text); void analyze(prompt.text, prompt.mode); }}><Sparkles size={12} />{prompt.text}</button>)}</div>

      {thinking && <div className="agent-thinking"><span className="agent-pulse"><Bot size={17} /></span><div><strong>AI Agent 正在分析…</strong><p><span><Check size={12} />讀取授權資料</span><span><Check size={12} />套用限定查詢</span><span className="active"><Clock3 size={12} />產生營運建議</span></p></div></div>}

      {error && <div className="inline-error"><Bot size={15} />{error}<button type="button" onClick={() => navigate('/operator/settings')}><Settings size={13} />前往系統設定</button></div>}

      {answer && <article className="agent-answer"><header><span><Bot size={17} /></span><div><small>AI AGENT 洞察與建議 · {answerModel}</small><h2>{answer.title}</h2></div></header><div className="agent-answer__grid"><section><b>Insight</b><p>{answer.insight}</p></section><section><b>Recommendation</b><p>{answer.recommendation}</p></section><section><b>Data basis</b><p>{answer.evidence}</p></section></div>{/派工/.test(answer.title) && <button type="button" onClick={onOpenTasks}>查看任務派發 →</button>}</article>}

      {history.length > 0 && <div className="agent-history"><strong>最近 Agent 任務</strong>{history.map((item, index) => <span key={`${item.time}-${index}`}><time>{item.time}</time>{item.query}</span>)}</div>}
    </section>
  );
};

export default AgentHero;
