import React, { useState } from 'react';
import { Camera, ClipboardCheck, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'user' | 'admin'>('user');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requested = (location.state as { from?: string } | null)?.from;
  const safeRequested = requested && /^\/(?!\/)/.test(requested) && !requested.includes('\\');

  if (!auth.isLoading && auth.user) return <Navigate to={safeRequested ? requested : auth.user.role === 'user' ? '/customer' : '/operator/dashboard'} replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const authenticatedUser = await auth.login(username.trim(), password);
      const roleHome = authenticatedUser.role === 'user' ? '/customer' : '/operator/dashboard';
      navigate(safeRequested ? requested : roleHome, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登入失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-irent-bg">
      <form onSubmit={submit} className="w-full max-w-[480px] bg-white border border-irent-line rounded-[24px] shadow-premium p-8 flex flex-col gap-5">
        <div className="flex items-center gap-3"><span className="w-12 h-12 rounded-2xl bg-irent-red text-white grid place-items-center font-black text-lg">iR</span><div><h1 className="text-2xl font-black text-irent-ink m-0">iRent Ops AI</h1><p className="text-xs text-irent-muted m-0">安全營運入口</p></div></div>
        <fieldset className="border-0 p-0 m-0">
          <legend className="text-sm font-bold text-irent-ink mb-2">選擇使用身分</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" aria-pressed={selectedRole === 'user'} onClick={() => setSelectedRole('user')} className={`text-left rounded-2xl border p-3 transition-colors ${selectedRole === 'user' ? 'border-irent-red bg-irent-soft-red' : 'border-irent-line hover:border-irent-red/50'}`}>
              <span className="flex items-center gap-2 text-sm font-extrabold text-irent-ink"><Camera size={17} className="text-irent-red" />使用者</span>
              <span className="block mt-1 text-xs leading-5 text-irent-muted">上傳取車／還車照片，通過 Laplacian 檢查後提交。</span>
            </button>
            <button type="button" aria-pressed={selectedRole === 'admin'} onClick={() => setSelectedRole('admin')} className={`text-left rounded-2xl border p-3 transition-colors ${selectedRole === 'admin' ? 'border-irent-red bg-irent-soft-red' : 'border-irent-line hover:border-irent-red/50'}`}>
              <span className="flex items-center gap-2 text-sm font-extrabold text-irent-ink"><ShieldCheck size={17} className="text-irent-red" />營運人員</span>
              <span className="block mt-1 text-xs leading-5 text-irent-muted">Operator 自領與處理案件；Admin 可指定人員並管理系統。</span>
            </button>
          </div>
          <p className="m-0 mt-2 text-xs text-irent-muted flex items-center gap-1"><ClipboardCheck size={14} />實際可用功能依登入帳號的後端角色判定。</p>
        </fieldset>
        <label className="flex flex-col gap-2 text-sm font-bold text-irent-ink"><span>使用者名稱</span><span className="flex items-center gap-2 border border-irent-line rounded-xl px-3 focus-within:border-irent-red"><UserRound size={17} className="text-irent-muted" /><input type="text" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]{3,32}" value={username} onChange={event => setUsername(event.target.value)} className="w-full h-11 outline-none" /></span></label>
        <label className="flex flex-col gap-2 text-sm font-bold text-irent-ink"><span>Password</span><span className="flex items-center gap-2 border border-irent-line rounded-xl px-3 focus-within:border-irent-red"><LockKeyhole size={17} className="text-irent-muted shrink-0" /><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className="min-w-0 flex-1 h-11 outline-none" /><button type="button" onClick={() => setShowPassword(visible => !visible)} aria-label={showPassword ? '隱藏密碼' : '顯示密碼'} className="shrink-0 text-irent-muted hover:text-irent-red transition-colors" title={showPassword ? '隱藏密碼' : '顯示密碼'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
        {error && <p role="alert" className="m-0 text-sm text-irent-red bg-irent-soft-red rounded-xl p-3">{error}</p>}
        <button type="submit" disabled={submitting} className="min-h-11 rounded-xl bg-irent-red text-white font-extrabold disabled:opacity-50">{submitting ? '登入中…' : '登入'}</button>
      </form>
    </main>
  );
};

export default Login;
