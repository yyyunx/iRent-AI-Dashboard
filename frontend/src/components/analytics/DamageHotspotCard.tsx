import React from 'react';
import { Sparkles } from 'lucide-react';

const DamageHotspotCard: React.FC<{ hotspots: [string, number][] }> = ({ hotspots }) => {
  const max = Math.max(1, ...hotspots.map(item => item[1]));
  const total = hotspots.reduce((sum, item) => sum + item[1], 0);
  return <section className="surface-card intelligence-card"><header><div><span className="eyebrow">DAMAGE INTELLIGENCE</span><h2>近 30 天車損熱區</h2></div><span className="ai-badge"><Sparkles size={12} />AI 分析</span></header><div className="hotspot-list">{hotspots.length ? hotspots.map(([label,count],index) => <div className="hotspot-item" key={label} title={`${count} 次，占已列熱點 ${total ? Math.round(count/total*100) : 0}%`}><strong>{label}</strong><div><span style={{ width: `${count/max*100}%` }} className={`hotspot-bar hotspot-bar--${index}`} /></div><b>{count} 次</b></div>) : <div className="intelligence-empty">尚無車損統計</div>}</div></section>;
};

export default DamageHotspotCard;
