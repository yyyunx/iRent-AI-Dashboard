import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CarFront,
  CheckCircle2,
  Clock3,
  MessageCircle,
  Plus,
  TrendingUp
} from 'lucide-react';
import { AppState } from '../../context/AppContext';
import KpiCard from './KpiCard';

interface DashboardHeaderProps {
  state: AppState | null;
  onCreateIncident: () => void;
  creating: boolean;
  isAdmin: boolean;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ state, onCreateIncident, creating, isAdmin }) => {
  const navigate = useNavigate();
  const incidents = state?.incidents || [];
  const active = incidents.filter(item => !['resolved', 'false_positive'].includes(item.status));
  const high = active.filter(item => item.severity === 'high').length;
  const medium = active.filter(item => item.severity === 'medium').length;
  const normal = incidents.filter(item => item.type === 'normal' || ['resolved', 'false_positive'].includes(item.status)).length;
  const lineConnected = Boolean(state?.lineConfig?.connected);

  return (
    <>
      <section className="dashboard-hero">
        <div className="dashboard-hero__copy">
          <span className="eyebrow">IRENT OPERATIONS AI</span>
          <h1>{isAdmin ? 'iRent AI 智慧營運中控台' : '我的 iRent 驗車 Dashboard'}</h1>
          <p>{isAdmin ? '即時掌握車況、異常與派工狀態，讓 AI 協助營運團隊更快完成處理。' : '查看自己的驗車提交與 Incident 處理狀態。'}</p>
        </div>
        <div className="dashboard-hero__actions">
          <div className="dashboard-hero__buttons">
            <button type="button" className="btn btn-primary" onClick={isAdmin ? onCreateIncident : () => navigate('/customer')} disabled={creating}>
              <Plus size={18} />{isAdmin ? (creating ? '建立中…' : '新增 Incident') : '提交 Incident'}
            </button>
            <button type="button" className="btn btn-line" onClick={() => navigate(isAdmin ? '/operator/notifications' : '/operator/submissions')}>
              <MessageCircle size={17} />{isAdmin ? '查看 LINE 通知' : '查看提交紀錄'}
            </button>
          </div>
          {isAdmin && <button type="button" className="line-status-card" onClick={() => navigate('/operator/settings')}>
            <span className="line-status-card__icon"><MessageCircle size={16} /></span>
            <span className={`line-status-card__dot ${lineConnected ? 'is-connected' : 'is-pending'}`} />
            <span><small>LINE 狀態</small><strong>{lineConnected ? '已連線' : '尚未連線'}</strong></span>
            <span className="line-status-card__meta">{lineConnected ? '通知服務運作中' : '前往設定 →'}</span>
          </button>}
        </div>
      </section>

      <section className="kpi-grid" aria-label="即時營運指標">
        <KpiCard icon={CarFront} label="目前車輛" value={incidents.length} trend="↑ 12%" trendTone="positive" hint="即時監控車輛" tone="blue" />
        <KpiCard icon={AlertTriangle} label="高優先異常" value={high} trend={high ? '需優先處理' : undefined} trendTone="warning" hint="等待營運處置" tone="red" />
        <KpiCard icon={Clock3} label="中度異常" value={medium} hint="持續追蹤" tone="amber" />
        <KpiCard icon={CheckCircle2} label="正常車輛" value={normal} hint="營運正常" tone="green" />
        <KpiCard icon={TrendingUp} label="自動結案率" value={state?.opsMetrics?.autoCloseRate || '0%'} trend="AI Review" trendTone="ai" hint="較人工流程提升" tone="purple" />
        <KpiCard icon={Activity} label="時間節省" value={state?.opsMetrics?.avgTimeSaved || '0分'} hint="預估處理縮短" tone="blue" />
      </section>
    </>
  );
};

export default DashboardHeader;
