import React from 'react';
import { ShieldX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Forbidden: React.FC = () => {
  const navigate = useNavigate();
  return <main className="min-h-screen grid place-items-center p-6 bg-irent-bg"><section className="max-w-md text-center bg-white border border-irent-line rounded-3xl shadow-premium p-9"><ShieldX size={48} className="mx-auto text-irent-red" /><h1 className="text-3xl font-black text-irent-ink mt-4 mb-2">403</h1><p className="text-irent-muted">你的帳號沒有權限開啟這個頁面。</p><button onClick={() => navigate('/operator/dashboard', { replace: true })} className="mt-4 min-h-11 px-5 rounded-xl bg-irent-red text-white font-bold">返回 Dashboard</button></section></main>;
};

export default Forbidden;
