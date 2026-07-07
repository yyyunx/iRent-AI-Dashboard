import React from 'react';
import { useApp } from '../../context/AppContext';
import { HelpCircle } from 'lucide-react';

const MapView: React.FC = () => {
  const { state, selectedId, setSelectedId } = useApp();

  const incidents = state?.incidents || [];
  const selected = incidents.find(i => i.id === selectedId) || incidents[0];

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

        <div className="relative flex-1 min-h-[640px] map-canvas m-4">
          {/* Static Mock Roads */}
          <div className="map-road r1"></div>
          <div className="map-road r2"></div>
          <div className="map-road r3"></div>
          <div className="map-road r4"></div>

          {/* Interactive Pins */}
          {incidents.map(item => {
            const isActive = item.id === selectedId;
            let severityColor = 'bg-irent-green';
            if (item.severity === 'high') severityColor = 'bg-irent-danger';
            else if (item.severity === 'medium') severityColor = 'bg-irent-orange';

            return (
              <button
                key={item.id}
                onClick={() => handlePinClick(item.id)}
                className={`map-pin ${severityColor} ${isActive ? 'active' : ''}`}
                style={{ left: `${item.x}%`, top: `${item.y}%` }}
                title={`${item.plate} ${item.label}`}
                aria-label={`${item.plate} ${item.label}`}
              />
            );
          })}
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
                <strong className="text-irent-ink text-xs font-extrabold">{selected.station}</strong>
              </div>
              <div className="flex justify-between border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">異常</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.label}</strong>
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
