import React from 'react';
import { ChevronRight, MapPin } from 'lucide-react';
import { Incident } from '../../context/AppContext';

const AgentDispatchCard: React.FC<{ incidents: Incident[]; onOpenTasks: () => void }> = ({ incidents, onOpenTasks }) => {
  const recommendations = [...incidents].filter(item => !['resolved','false_positive'].includes(item.status)).sort((a,b) => b.score-a.score).slice(0,4);
  return <section className="surface-card intelligence-card dispatch-card"><header><div><span className="eyebrow">RECOMMEND & ACT</span><h2>Agent 建議派工</h2></div><button type="button" onClick={onOpenTasks}>查看全部 <ChevronRight size={13} /></button></header><div className="dispatch-list">{recommendations.length ? recommendations.map(item => <article key={item.id}><span className="dispatch-pin"><MapPin size={14} /></span><div><strong>{item.station}</strong><p>{item.plate} · {item.label}</p></div><span className={`priority-badge priority-badge--${item.severity === 'high' ? 'danger' : item.severity === 'medium' ? 'warning' : 'success'}`}>{item.severity === 'high' ? '高優先' : item.severity === 'medium' ? '中優先' : '一般'}</span><time>{item.time}</time></article>) : <div className="intelligence-empty">目前沒有待派工事件</div>}</div></section>;
};

export default AgentDispatchCard;
