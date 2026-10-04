import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Incident, useApp } from '../../context/AppContext';
import { HelpCircle } from 'lucide-react';
import UrgencyBadge, { urgencyColor } from '../../components/dashboard/UrgencyBadge';

const MapView: React.FC = () => {
  const { state, selectedId, setSelectedId } = useApp();

  const incidents = state?.incidents || [];
  const selected = incidents.find(i => i.id === selectedId) || incidents[0];
  const hasGps = selected && selected.latitude !== null && selected.longitude !== null;

  const handlePinClick = (id: string) => {
    setSelectedId(id);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-[22px]">
      {/* Map Canvas */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium overflow-hidden flex flex-col">
        <div className="bg-[#fff8f8] border-b border-[#f4d7d7] px-5 py-4 flex justify-between items-center">
          <h2 className="text-[#222222] text-lg font-black m-0">地圖模式</h2>
          <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">站點即時風險分布</span>
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-irent-line p-3">
          {incidents.filter(item => item.latitude !== null && item.longitude !== null).map(item => <button key={item.id} onClick={() => handlePinClick(item.id)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${item.id === selected?.id ? 'border-irent-red bg-irent-soft-red text-irent-red' : 'border-irent-line bg-white text-irent-muted'}`}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: urgencyColor(item.urgencyScore) }} />{item.plate}</button>)}
          {!incidents.some(item => item.latitude !== null && item.longitude !== null) && <span className="text-xs text-irent-muted">目前沒有含 GPS 的 Incident marker。</span>}
        </div>

        <div className="relative flex-1 min-h-[640px] map-canvas m-4 overflow-hidden rounded-2xl border border-irent-line bg-slate-100">
          {hasGps ? <OsmIncidentMap incidents={incidents} selectedId={selected!.id} onSelect={handlePinClick} /> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-irent-muted"><HelpCircle size={40} className="text-irent-line" /><strong>此 Incident 未提供 GPS</strong><span className="max-w-sm text-xs leading-relaxed">仍保留手動停車資訊：{selected ? [selected.address || selected.station, selected.parkingFacility, selected.floor, selected.pillar, selected.parkingSlot].filter(Boolean).join(' / ') : '-'}</span></div>}
        </div>
      </section>

      {/* Station detail panel */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-5">
        <div className="border-b border-irent-line pb-3">
          <h2 className="text-lg font-black text-irent-ink m-0">站點詳情</h2>
        </div>

        {selected ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2.5">
              <div className={`h-[130px] rounded-2xl border border-slate-100 flex items-center justify-center text-xs font-bold text-white relative overflow-hidden bg-cover bg-center ${
                selected.type === 'cleaning' 
                  ? 'bg-[radial-gradient(circle_at_72%_64%,#d14a32_0_6,transparent_7),linear-gradient(160deg,#2f3a49_0_38%,#e2e8f0_39%_48%,#64748b_49%_100%)]' 
                  : 'bg-[linear-gradient(35deg,#eeeeee_0%,#ffffff_44%,#d6d6d6_45%,#eeeeee_100%)]'
              }`}>
                <span className="absolute bottom-2.5 left-2.5 bg-irent-red/90 text-white rounded-full px-2.5 py-1 text-xs font-black shadow-sm">現場照片</span>
              </div>
              <div className="h-[130px] rounded-2xl border border-slate-100 flex items-center justify-center text-xs font-bold text-white relative overflow-hidden bg-[linear-gradient(35deg,#eeeeee_0%,#ffffff_44%,#d6d6d6_45%,#eeeeee_100%)]">
                <span className="absolute bottom-2.5 left-2.5 bg-irent-red/90 text-white rounded-full px-2.5 py-1 text-xs font-black shadow-sm">站點紀錄</span>
              </div>
            </div>

            <div className="grid gap-2 border-b border-irent-line pb-4">
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">車號</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.plate}</strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">站點</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.address || selected.station}</strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">異常</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.label}</strong><UrgencyBadge score={selected.urgencyScore} issueCount={selected.issueCount} />
              </div>
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">最近租客</span>
                <strong className="text-irent-ink text-xs font-extrabold">已可查詢</strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">預估處理</span>
                <strong className="text-irent-ink text-xs font-extrabold">
                  {selected.type === 'damage' ? '客服確認 8 分鐘' : '清潔 15 分鐘'}
                </strong>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-irent-muted pt-1">
                <span>停車場：<strong className="text-irent-ink">{selected.parkingFacility || '-'}</strong></span><span>樓層：<strong className="text-irent-ink">{selected.floor || '-'}</strong></span>
                <span>區域：<strong className="text-irent-ink">{selected.zone || '-'}</strong></span><span>柱號：<strong className="text-irent-ink">{selected.pillar || '-'}</strong></span>
                <span>車格：<strong className="text-irent-ink">{selected.parkingSlot || '-'}</strong></span><span>補充：<strong className="text-irent-ink">{selected.locationNote || '-'}</strong></span>
              </div>
            </div>

            <div className="bg-irent-soft-red border border-[#f0d4d4] rounded-2xl p-3.5 text-xs text-[#3a2a2a] leading-relaxed">
              {selected.type === 'damage' 
                ? `${selected.plate} 在 ${selected.station} 回報 ${selected.label}，AI 信心度 ${selected.confidence}%。建議先由客服比對租前照片與最近租客紀錄，確認後再建立檢修或求償流程。`
                : selected.type === 'cleaning'
                  ? `${selected.plate} 在 ${selected.station} 偵測到 ${selected.label}，下一位預約約 ${selected.nextBooking} 分鐘後。建議立即派最近清潔人員處理，完成後回傳照片更新車況。`
                  : `${selected.plate} 的還車照片已通過檢查，目前可維持上架營運。系統仍會保留紀錄，供後續趨勢分析使用。`
              }
            </div>
          </div>
        ) : (
          <div className="text-center py-20 text-irent-muted flex flex-col items-center justify-center gap-2">
            <HelpCircle size={40} className="text-irent-line" />
            目前沒有可顯示詳情的事件。
          </div>
        )}
      </section>
    </div>
  );
};

export default MapView;


const OsmIncidentMap: React.FC<{ incidents: Incident[]; selectedId: string; onSelect: (id: string) => void }> = ({ incidents, selectedId, onSelect }) => {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const gpsIncidents = incidents.filter(item => item.latitude !== null && item.longitude !== null);

  useEffect(() => {
    if (!host.current || map.current) return;
    map.current = L.map(host.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; layer.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const selected = gpsIncidents.find(item => item.id === selectedId) || gpsIncidents[0];
    for (const item of gpsIncidents) {
      const icon = L.divIcon({ className: 'irent-osm-marker', html: `<span style="background:${urgencyColor(item.urgencyScore)}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      const popup = `<strong>${escapeHtml(item.plate)}</strong><br/>Incident: ${escapeHtml(item.label)}<br/>緊急程度：${item.urgencyScore}/10 (${item.issueCount} 個異常)<br/>Damage / Dirty: ${escapeHtml(item.type)}<br/>地址：${escapeHtml(item.address || item.station)}<br/>停車場：${escapeHtml(item.parkingFacility || '-')}<br/>樓層：${escapeHtml(item.floor || '-')}　區域：${escapeHtml(item.zone || '-')}<br/>柱號：${escapeHtml(item.pillar || '-')}　車格：${escapeHtml(item.parkingSlot || '-')}<br/>時間：${escapeHtml(item.time)}`;
      L.marker([item.latitude!, item.longitude!], { icon }).bindPopup(popup).on('click', () => onSelect(item.id)).addTo(layer.current);
    }
    if (selected) map.current.setView([selected.latitude!, selected.longitude!], 17);
  }, [gpsIncidents, selectedId, onSelect]);

  return <div ref={host} className="absolute inset-0" aria-label="OpenStreetMap Incident map" />;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] || character));
}
