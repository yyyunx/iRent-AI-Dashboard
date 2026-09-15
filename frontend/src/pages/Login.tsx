import React, { useState } from 'react';
import { LockKeyhole, Mail } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!auth.isLoading && auth.user) return <Navigate to="/operator/dashboard" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await auth.login(email.trim(), password);
      const requested = (location.state as { from?: string } | null)?.from;
      const safeRequested = requested && /^\/(?!\/)/.test(requested) && !requested.includes('\\');
      navigate(safeRequested ? requested : '/operator/dashboard', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登入失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-irent-bg">
      <form onSubmit={submit} className="w-full max-w-[420px] bg-white border border-irent-line rounded-[24px] shadow-premium p-8 flex flex-col gap-5">
        <div className="flex items-center gap-3"><span className="w-12 h-12 rounded-2xl bg-irent-red text-white grid place-items-center font-black text-lg">iR</span><div><h1 className="text-2xl font-black text-irent-ink m-0">iRent Ops AI</h1><p className="text-xs text-irent-muted m-0">安全營運入口</p></div></div>
        <label className="flex flex-col gap-2 text-sm font-bold text-irent-ink"><span>Email</span><span className="flex items-center gap-2 border border-irent-line rounded-xl px-3 focus-within:border-irent-red"><Mail size={17} className="text-irent-muted" /><input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} className="w-full h-11 outline-none" /></span></label>
        <label className="flex flex-col gap-2 text-sm font-bold text-irent-ink"><span>Password</span><span className="flex items-center gap-2 border border-irent-line rounded-xl px-3 focus-within:border-irent-red"><LockKeyhole size={17} className="text-irent-muted" /><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className="w-full h-11 outline-none" /></span></label>
        {error && <p role="alert" className="m-0 text-sm text-irent-red bg-irent-soft-red rounded-xl p-3">{error}</p>}
        <button type="submit" disabled={submitting} className="min-h-11 rounded-xl bg-irent-red text-white font-extrabold disabled:opacity-50">{submitting ? '登入中…' : '登入'}</button>
      </form>
    </main>
  );
};

export default Login;
