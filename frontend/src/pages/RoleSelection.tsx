import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const RoleSelection: React.FC = () => {
  const navigate = useNavigate();
  const { setCurrentRole } = useApp();

  const selectRole = (role: 'customer' | 'operator') => {
    setCurrentRole(role);
    if (role === 'customer') {
      navigate('/customer');
    } else {
      navigate('/operator');
    }
  };

  return (
    <section className="min-h-screen grid place-items-center p-7 bg-irent-bg">
      <div className="w-[560px] max-w-full border border-irent-line rounded-[20px] bg-white shadow-premium p-[34px] flex flex-col items-center text-center gap-4">
        <div className="w-11 h-11 rounded-2xl bg-irent-red text-white flex items-center justify-center font-extrabold text-lg shadow-[0_10px_22px_rgba(198,40,40,0.22)] mb-1">
          iR
        </div>
        <h1 className="text-[#161616] text-2xl font-black m-0">iRent AI 智慧營運中控台</h1>
        <p className="text-irent-muted text-sm m-0">請選擇身分，系統會顯示對應的使用流程。</p>
        
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
          <button 
            onClick={() => selectRole('customer')}
            className="w-full min-h-[44px] rounded-2xl bg-irent-red text-white font-extrabold border border-irent-red hover:-translate-y-0.5 hover:shadow-hover transition-all duration-200"
          >
            我是使用者
          </button>
          <button 
            onClick={() => selectRole('operator')}
            className="w-full min-h-[44px] rounded-2xl bg-white text-irent-red font-extrabold border border-irent-red hover:-translate-y-0.5 hover:shadow-hover transition-all duration-200"
          >
            我是營運人員
          </button>
        </div>
      </div>
    </section>
  );
};

export default RoleSelection;
