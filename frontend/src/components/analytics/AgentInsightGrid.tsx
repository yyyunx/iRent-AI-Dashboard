import React from 'react';
import { AlertTriangle, BarChart3, ClipboardList, FileText } from 'lucide-react';
import { AppState } from '../../context/AppContext';

interface Props { state: AppState | null; onPrompt: (prompt: string) => void; onOpenTasks: () => void; }

const AgentInsightGrid: React.FC<Props> = ({ state, onPrompt, onOpenTasks }) => {
  const incidents = state?.incidents || [];
  const active = incidents.filter(item => !['resolved', 'false_positive'].includes(item.status));
  const high = active.filter(item => item.severity === 'high');
  const hotspot = state?.damageHotspots?.[0];
  const cards = [
    { icon: AlertTriangle, tone: 'red', label: '風險摘要', title: high.length ? `${high.length} 件高優先事件需關注` : '目前無高優先事件', body: high.length ? `最高分事件：${[...high].sort((a,b) => b.score-a.score)[0]?.plate}` : '車隊目前沒有高嚴重度待辦。', badge: high.length ? '需關注' : '正常', action: () => onPrompt('盤點目前高風險事件') },
    { icon: BarChart3, tone: 'purple', label: '熱點洞察', title: hotspot ? `${hotspot[0]}累計 ${hotspot[1]} 次` : '尚無熱點資料', body: hotspot ? '近 30 天事件數最高的車損位置。' : '等待更多車損資料後分析。', badge: 'AI 分析', action: () => onPrompt('分析近 30 天車損熱點與預防保養建議') },
    { icon: ClipboardList, tone: 'blue', label: '派工建議', title: `${active.length} 件待處理 Incident`, body: '依 Priority Score、嚴重度與預約時間排序。', badge: '即時資料', action: onOpenTasks },
    { icon: FileText, tone: 'green', label: '營運摘要', title: `自動結案率 ${state?.opsMetrics?.autoCloseRate || '0%'}`, body: `目前預估節省 ${state?.opsMetrics?.avgTimeSaved || '0分'}。`, badge: '今日', action: () => onPrompt('生成今日車隊維護效率與時間節省摘要') }
  ];
  return <section className="agent-insights"><header><div><span className="eyebrow">TODAY</span><h2>今日 Agent 洞察</h2></div><p>基於即時數據與既有模型結果，整理目前最需要關注的營運資訊。</p></header><div className="agent-insight-grid">{cards.map(card => { const Icon=card.icon; return <button type="button" key={card.label} className={`agent-insight-card agent-insight-card--${card.tone}`} onClick={card.action}><span className="agent-insight-card__icon"><Icon size={19} /></span><span className="agent-insight-card__badge">{card.badge}</span><small>{card.label}</small><strong>{card.title}</strong><p>{card.body}</p><b>查看 Agent 分析 →</b></button>; })}</div></section>;
};

export default AgentInsightGrid;
