import React from 'react';
import { useApp } from '../context/AppContext';

export const ToastContainer: React.FC = () => {
  const { toastStack, removeToast } = useApp();

  if (toastStack.length === 0) return null;

  return (
    <div className="fixed right-[18px] bottom-[18px] grid gap-2.5 z-50 w-[360px] max-w-[calc(100vw-36px)]" aria-live="polite">
      {toastStack.map(toast => (
        <div
          key={toast.id}
          className="rounded-2xl border border-[#f0d4d4] bg-white p-3.5 shadow-premium animate-pop cursor-pointer hover:shadow-hover transition-all"
          onClick={() => removeToast(toast.id)}
        >
          <strong className="block text-irent-ink text-sm mb-1">{toast.title}</strong>
          <p className="m-0 text-irent-muted text-xs leading-relaxed">{toast.text}</p>
        </div>
      ))}
    </div>
  );
};
