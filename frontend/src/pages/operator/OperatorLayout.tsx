import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  BellRing,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Search,
  Settings,
  SquareKanban,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import DashboardHeader from '../../components/dashboard/DashboardHeader';

const OperatorLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, apiPost, showToast, searchQuery, setSearchQuery } = useApp();
  const auth = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const isDashboard = location.pathname === '/operator/dashboard';

  const now = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).format(new Date());
  const openCount = state?.incidents.filter(item => !['resolved', 'false_positive'].includes(item.status)).length || 0;

  const navItems = [
    { path: '/operator/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/operator/submissions', label: '提交紀錄', icon: History, badge: state?.photoSubmissions?.length },
    { path: '/operator/map', label: '地圖模式', icon: MapPin },
    { path: '/operator/tasks', label: '任務派發', icon: SquareKanban, badge: openCount },
    { path: '/operator/notifications', label: 'LINE 通知', icon: BellRing, line: true },
    { path: '/operator/analytics', label: '營運分析', icon: BarChart3, textBadge: '30d' },
    { path: '/operator/settings', label: '系統設定', icon: Settings }
  ];

  const go = (path: string) => { navigate(path); setMobileOpen(false); };

  const createIncident = async () => {
    setCreating(true);
    const isDamage = Math.random() > 0.45;
    const incident = {
      plate: `NEW-${Math.floor(1000 + Math.random() * 8999)}`,
      station: '板橋車站',
      type: isDamage ? 'damage' : 'cleaning',
      label: isDamage ? '新增左前保桿擦傷' : '車內地墊髒污',
      severity: 'high', confidence: 95, time: new Date().toLocaleTimeString('zh-TW', { hour12: false }).substring(0, 5),
      nextBooking: 22, hotStation: true, x: 55, y: 51, assignee: 'pending', status: 'pending_assignment', score: 0
    };
    try {
      await apiPost('/api/incidents', incident);
      showToast('AI 新增 Incident', `${incident.plate} 已建立。`);
      navigate('/operator/dashboard');
    } catch (error: any) {
      showToast('建立失敗', error.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ops-shell">
      {mobileOpen && <button className="sidebar-scrim" aria-label="關閉選單" onClick={() => setMobileOpen(false)} />}
      <aside className={`ops-sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sidebar-brand"><span className="sidebar-brand__mark">iR</span><span><strong>iRent Ops AI</strong><small>Incident to Action</small></span><button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="關閉選單"><X size={19} /></button></div>
        <nav aria-label="營運後台選單">
          {navItems.filter(item => auth.user?.role === 'admin' || !['/operator/settings', '/operator/analytics'].includes(item.path)).map(item => {
            const active = location.pathname === item.path;
            const Icon = item.icon;
            return <button key={item.path} className={`${active ? 'active' : ''} ${item.line ? 'line-item' : ''}`} onClick={() => go(item.path)}><span><Icon size={19} strokeWidth={1.9} /><b>{item.label}</b></span>{item.badge ? <em>{item.badge}</em> : item.textBadge ? <em>{item.textBadge}</em> : null}</button>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <button type="button" className="sidebar-user" onClick={async () => { await auth.logout(); navigate('/login', { replace: true }); }}><span className="avatar">iR</span><span><strong>{auth.user?.username}</strong><small>{auth.user?.role === 'admin' ? '營運管理員' : '一般使用者'}</small></span><LogOut size={16} strokeWidth={1.75} aria-label="登出" /></button>
      </aside>

      <main className="ops-main">
        <header className="topbar">
          <button type="button" className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="開啟選單"><Menu size={21} /></button>
          <label className="topbar-search"><Search size={18} /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="搜尋事件、車號、站點或關鍵字…" aria-label="全域搜尋" /></label>
          <div className="topbar-actions"><span className="topbar-username">{auth.user?.username}</span>{auth.user?.role === 'admin' && <button type="button" className="notification-button" onClick={() => navigate('/operator/notifications')} aria-label="查看 LINE 通知"><Bell size={19} /><span /></button>}<time>{now}</time>{auth.user?.role === 'admin' && <button type="button" className="topbar-settings-btn" onClick={() => navigate('/operator/settings')} aria-label="系統設定" title="系統設定"><Settings size={20} /></button>}</div>
        </header>

        {isDashboard && <DashboardHeader state={state} onCreateIncident={createIncident} creating={creating} isAdmin={auth.user?.role === 'admin'} />}
        <div className={isDashboard ? '' : 'page-surface'}><Outlet /></div>
      </main>
    </div>
  );
};

export default OperatorLayout;
