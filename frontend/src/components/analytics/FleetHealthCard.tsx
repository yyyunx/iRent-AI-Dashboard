import React from 'react';
import { Incident } from '../../context/AppContext';

const FleetHealthCard: React.FC<{ incidents: Incident[] }> = ({ incidents }) => {
  const total = incidents.length;
  const healthy = incidents.filter(item => item.type === 'normal' || ['resolved','resolved'].includes(item.status)).length;
  const attention = incidents.filter(item => !['resolved','resolved'].includes(item.status) && item.severity !== 'high').length;
  const maintenance = Math.max(0, total - healthy - attention);
  const score = total ? Math.round(healthy / total * 100) : 0;
  const segments = [{ label:'正常／已完成', count:healthy, tone:'green' }, { label:'需注意', count:attention, tone:'amber' }, { label:'待維修', count:maintenance, tone:'red' }];
  return <section className="surface-card intelligence-card"><header><div><span className="eyebrow">FLEET STATUS</span><h2>Fleet Health</h2></div><span className="data-badge">事件狀態推導</span></header>{total ? <div className="fleet-health"><div className="fleet-gauge" style={{ '--health': `${score * 3.6}deg` } as React.CSSProperties}><div><strong>{score}%</strong><span>可營運／已處理</span></div></div><div className="fleet-breakdown">{segments.map(item => <div key={item.label}><span className={`fleet-dot fleet-dot--${item.tone}`} /><strong>{item.label}</strong><b>{item.count} 件</b><small>{Math.round(item.count/total*100)}%</small></div>)}<p>此指標依目前 Incident 狀態計算；後端未提供單車健康分數，因此不顯示虛構的逐車百分比。</p></div></div> : <div className="intelligence-empty">尚無車隊事件資料</div>}</section>;
};

export default FleetHealthCard;
