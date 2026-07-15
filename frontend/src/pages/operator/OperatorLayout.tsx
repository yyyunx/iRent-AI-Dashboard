import React from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { 
  LayoutDashboard, 
  History, 
  MapPin, 
  KanbanSquare, 
  BellRing, 
  BarChart3, 
  LogOut, 
  PlusCircle, 
  MessageSquare,
  Activity,
  AlertOctagon,
  ShieldAlert,
  CheckCircle,
  TrendingUp,
  Award,
  Zap,
  Settings
} from 'lucide-react';

const OperatorLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, apiPost, showToast, setCurrentRole } = useApp();

  const activePath = location.pathname;

  const navItems = [
    { path: '/operator/dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: state?.incidents.filter(i => i.status !== 'resolved' && i.status !== 'done').length },
    { path: '/operator/submissions', label: '提交紀錄', icon: History, badge: state?.photoSubmissions?.length },
    { path: '/operator/map', label: '地圖模式', icon: MapPin, textBadge: 'Live' },
    { path: '/operator/tasks', label: '任務派發', icon: KanbanSquare, badge: state?.incidents.filter(i => i.status !== 'resolved' && i.status !== 'done' && i.type !== 'normal').length },
    { path: '/operator/notifications', label: 'Slack 通知', icon: BellRing, badge: state?.lineLogs?.length },
    { path: '/operator/analytics', label: '營運分析', icon: BarChart3, textBadge: '30d' },
    { path: '/operator/settings', label: '系統設定', icon: Settings },
  ];

  const handleSimulate = async () => {
    const next = 308 + (state?.incidents.length || 0);
    const isDamage = Math.random() > 0.45;
    const newItem = {
      id: `INC-${next}`,
      plate: "NEW-" + Math.floor(1000 + Math.random() * 8999),
      station: "板橋車站",
      type: isDamage ? "damage" : "cleaning",
      label: isDamage ? "新增左前保桿擦傷" : "車內地墊髒污",
      severity: "high",
      confidence: 92 + Math.floor(Math.random() * 7),
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false }).substring(0, 5),
      nextBooking: 22,
      hotStation: true,
      x: 47 + Math.random() * 20,
      y: 46 + Math.random() * 22,
      assignee: "pending",
      status: "todo",
      score: 0
    };

    try {
      await apiPost('/api/incidents', newItem);
      showToast("AI 新增 Incident", `${newItem.plate} 已寫入 SQLite 並自動通知 Slack。`);
      navigate('/operator/dashboard');
    } catch (error: any) {
      showToast("模擬失敗", error.message);
    }
  };

  const highCount = state?.incidents.filter(i => i.severity === 'high' && i.status !== 'resolved' && i.status !== 'done').length || 0;
  const mediumCount = state?.incidents.filter(i => i.severity === 'medium' && i.status !== 'resolved' && i.status !== 'done').length || 0;
  const normalCount = Math.max(0, 18 - highCount - mediumCount);

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[276px_minmax(0,1fr)] pt-2 border-t-8 border-irent-red bg-irent-bg overflow-x-hidden">
      {/* Sidebar */}
      <aside className="bg-white border-r border-irent-line p-3 sm:p-5 lg:p-[26px_20px] shadow-sm flex flex-col gap-4 lg:gap-6 lg:h-[calc(100vh-8px)] lg:sticky lg:top-2 min-w-0">
        <div className="brand flex items-center gap-3 pb-[18px] border-b border-irent-line min-h-[52px]">
          <div className="w-11 h-11 rounded-2xl bg-irent-red text-white flex items-center justify-center font-extrabold text-lg shadow-[0_10px_22px_rgba(198,40,40,0.22)]">
            iR
          </div>
          <div className="min-w-0">
            <strong className="text-irent-red text-[17px] font-extrabold block">iRent Ops AI</strong>
            <small className="text-irent-muted text-xs">Incident to Action</small>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0" aria-label="主選單">
          {navItems.map(item => {
            const isActive = activePath === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex items-center justify-between gap-3 px-3 sm:px-4 py-3 rounded-2xl text-sm font-bold min-w-[118px] sm:min-w-[130px] lg:min-w-0 flex-shrink-0 transition-all ${
                  isActive 
                    ? 'bg-irent-red text-white shadow-[0_12px_24px_rgba(198,40,40,0.20)]' 
                    : 'text-[#404040] hover:bg-irent-soft-red hover:text-irent-red'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon size={18} />
                  <span className="whitespace-nowrap lg:whitespace-normal break-anywhere">{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className={`text-[11px] font-black rounded-full px-2 py-0.5 ${
                    isActive ? 'bg-white/20 text-white' : 'bg-irent-soft-red text-irent-red'
                  }`}>
                    {item.badge}
                  </span>
                )}
                {item.textBadge && (
                  <span className={`text-[11px] font-black rounded-full px-2 py-0.5 ${
                    isActive ? 'bg-white/20 text-white' : 'bg-irent-soft-red text-irent-red'
                  }`}>
                    {item.textBadge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Exit */}
        <div className="mt-auto hidden lg:flex flex-col gap-3">
          <div className="border border-irent-line rounded-2xl p-3.5 text-xs text-irent-muted leading-relaxed bg-[#fafafa]">
            AI 辨識結果會先轉成 Incident，再依優先分數建立任務、推播通知，最後由人員回報並更新車輛狀態。
          </div>
          <button
            onClick={() => { setCurrentRole(null); navigate('/'); }}
            className="flex items-center justify-center gap-2 min-h-[42px] w-full rounded-2xl border border-irent-line text-irent-muted hover:bg-irent-soft-red hover:text-irent-red hover:border-irent-red transition-all text-sm font-bold"
          >
            <LogOut size={16} />
            切換身分
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="p-[12px] sm:p-5 lg:p-7 min-w-0 max-w-full overflow-x-hidden">
        {/* Topbar */}
        <section className="bg-white border border-irent-line rounded-2xl p-4 sm:p-5 shadow-premium flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 min-w-0">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 mb-2.5 rounded-full bg-irent-soft-red text-irent-red text-[13px] font-black">
              <Zap size={13} />
              iRent AI Dashboard
            </div>
            <h1 className="text-[#161616] text-2xl sm:text-3xl font-black leading-tight break-anywhere">iRent AI 智慧營運中控台</h1>
            <p className="text-irent-muted text-sm mt-1 break-anywhere">把「AI 有看到問題」變成「營運已經開始處理」。</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 w-full md:w-auto">
            <button 
              onClick={() => navigate('/operator/notifications')}
              className="w-full sm:flex-1 md:flex-initial min-h-[44px] px-4 rounded-2xl border border-irent-red text-irent-red font-bold hover:shadow-hover hover:-translate-y-0.5 transition-all text-sm flex items-center justify-center gap-2 break-anywhere"
            >
              <MessageSquare size={16} />
              查看 Slack 通知
            </button>
            <button 
              onClick={handleSimulate}
              className="w-full sm:flex-1 md:flex-initial min-h-[44px] px-4 rounded-2xl bg-irent-red text-white font-bold hover:shadow-hover hover:-translate-y-0.5 transition-all text-sm flex items-center justify-center gap-2 break-anywhere"
            >
              <PlusCircle size={16} />
              模擬新增 Incident
            </button>
          </div>
        </section>

        {/* Metrics Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-6" aria-label="即時指標">
          <div className="bg-white border border-irent-line rounded-2xl p-4 shadow-premium hover:-translate-y-0.5 hover:shadow-hover transition-all flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-irent-muted text-xs font-bold">
              <Activity size={14} className="text-blue-500" />
              目前車輛
            </div>
            <strong className="text-blue-500 text-3xl font-black">18</strong>
          </div>

          <div className="bg-white border border-irent-line rounded-2xl p-4 shadow-premium hover:-translate-y-0.5 hover:shadow-hover transition-all flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-irent-muted text-xs font-bold">
              <ShieldAlert size={14} className="text-irent-danger" />
              高優先異常
            </div>
            <strong className="text-irent-danger text-3xl font-black">{highCount}</strong>
          </div>

          <div className="bg-white border border-irent-line rounded-2xl p-4 shadow-premium hover:-translate-y-0.5 hover:shadow-hover transition-all flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-irent-muted text-xs font-bold">
              <AlertOctagon size={14} className="text-irent-orange" />
              中度異常
            </div>
            <strong className="text-irent-orange text-3xl font-black">{mediumCount}</strong>
          </div>

          <div className="bg-white border border-irent-line rounded-2xl p-4 shadow-premium hover:-translate-y-0.5 hover:shadow-hover transition-all flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-irent-muted text-xs font-bold">
              <CheckCircle size={14} className="text-irent-green" />
              正常車輛
            </div>
            <strong className="text-irent-green text-3xl font-black">{normalCount}</strong>
          </div>

          <div className="bg-white border border-irent-line rounded-2xl p-4 shadow-premium hover:-translate-y-0.5 hover:shadow-hover transition-all flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-irent-muted text-xs font-bold">
              <TrendingUp size={14} className="text-irent-red" />
              自動結案率
            </div>
            <strong className="text-irent-red text-3xl font-black">{state?.opsMetrics?.autoCloseRate || '0%'}</strong>
          </div>

          <div className="bg-white border border-irent-line rounded-2xl p-4 shadow-premium hover:-translate-y-0.5 hover:shadow-hover transition-all flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-irent-muted text-xs font-bold">
              <Award size={14} className="text-irent-orange" />
              審核減少
            </div>
            <strong className="text-irent-orange text-3xl font-black">{state?.opsMetrics?.manualReviewReduced ?? 0}</strong>
          </div>

          <div className="bg-white border border-irent-line rounded-2xl p-4 shadow-premium hover:-translate-y-0.5 hover:shadow-hover transition-all flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-irent-muted text-xs font-bold">
              <Zap size={14} className="text-irent-green" />
              時間節省
            </div>
            <strong className="text-irent-green text-3xl font-black">{state?.opsMetrics?.avgTimeSaved || '0分'}</strong>
          </div>
        </section>

        {/* Page Outlet */}
        <Outlet />
      </main>
    </div>
  );
};

export default OperatorLayout;
