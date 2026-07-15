import React from 'react';
import { useApp } from '../../context/AppContext';
import { HelpCircle } from 'lucide-react';

const Analytics: React.FC = () => {
  const { state } = useApp();

  const damageHotspots = state?.damageHotspots || [];
  const incidents = state?.incidents || [];

  const maxHotspotCount = damageHotspots.length > 0 ? Math.max(...damageHotspots.map(row => row[1])) : 1;

  // Calculate fleet health scores
  const fleetHealths = incidents.slice(0, 5).map(item => {
    const clean = item.type === "cleaning" ? 62 : 92;
    const damage = item.type === "damage" ? 58 : 90;
    const usage = item.nextBooking < 40 ? 72 : 84;
    const score = Math.round(clean * 0.4 + damage * 0.4 + usage * 0.2);
    return {
      plate: item.plate,
      station: item.station,
      label: item.label,
      health: score
    };
  }).sort((a, b) => a.health - b.health);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-4 lg:gap-5 items-start min-w-0">
      {/* Damage Hotspots */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-4 sm:p-5 flex flex-col gap-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pb-3 border-b border-irent-line">
          <h2 className="text-lg font-black text-irent-ink m-0">近 30 天車損熱區</h2>
          <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">維修預測</span>
        </div>

        <div className="flex flex-col gap-3.5 py-2">
          {damageHotspots.length > 0 ? (
            damageHotspots.map(([label, count]) => (
              <div key={label} className="grid grid-cols-[minmax(0,1fr)_44px] sm:grid-cols-[minmax(110px,140px)_minmax(0,1fr)_44px] gap-2 sm:gap-3 items-center text-sm">
                <strong className="text-irent-ink font-extrabold break-anywhere">{label}</strong>
                <div className="col-span-2 sm:col-span-1 sm:col-start-2 h-5 rounded-full bg-[#edf1f5] overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-irent-red"
                    style={{ width: `${(count / maxHotspotCount) * 100}%` }}
                  />
                </div>
                <span className="text-irent-muted font-bold text-right">{count}次</span>
              </div>
            ))
          ) : (
            <p className="text-irent-muted text-xs text-center py-10">尚無車損統計</p>
          )}
        </div>
      </section>

      {/* Fleet Health Status */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-4 sm:p-5 flex flex-col gap-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pb-3 border-b border-irent-line">
          <h2 className="text-lg font-black text-irent-ink m-0">Fleet Health</h2>
          <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">
            乾淨度 40% + 車損 40% + 租借 20%
          </span>
        </div>

        <div className="flex flex-col gap-3 max-h-[560px] overflow-y-auto">
          {fleetHealths.length > 0 ? (
            fleetHealths.map((item, index) => (
              <article key={index} className="border border-irent-line rounded-2xl p-3.5 flex flex-col gap-2 bg-white">
                <div className="flex justify-between items-center gap-2 text-sm">
                  <strong className="text-[#222222] font-black">{item.plate}</strong>
                  <span className="text-irent-ink font-bold">{item.health}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-[#edf1f5] overflow-hidden">
                  <div 
                    className="h-full bg-irent-red"
                    style={{ width: `${item.health}%` }}
                  />
                </div>
                <span className="text-irent-muted text-xs block break-anywhere">
                  {item.station} · {item.label}
                </span>
              </article>
            ))
          ) : (
            <div className="text-center py-20 text-irent-muted flex flex-col items-center justify-center gap-2">
              <HelpCircle size={40} className="text-irent-line" />
              無車輛健康度資訊
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Analytics;
