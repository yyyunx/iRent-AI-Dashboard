import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

const Tasks: React.FC = () => {
  const navigate = useNavigate();
  const { state, setSelectedId } = useApp();

  const incidents = state?.incidents || [];

  const handleCardClick = (id: string) => {
    setSelectedId(id);
    navigate('/operator/dashboard');
  };

  const getTaskStatusText = (status: string) => {
    return status === 'assigned' ? '已派工'
      : status === 'waiting_review' ? 'Need Human Review'
      : status === 'resolved' || status === 'done' ? 'Closed'
      : 'AI Detect';
  };

  // Group columns
  const todoTasks = incidents.filter(i => i.type !== 'normal' && (i.status === 'todo' || i.status === 'ai_review_pending'));
  const assignedTasks = incidents.filter(i => i.type !== 'normal' && (i.status === 'assigned' || i.status === 'in_progress' || i.status === 'waiting_review'));
  const doneTasks = incidents.filter(i => i.type !== 'normal' && (i.status === 'resolved' || i.status === 'done'));

  const renderColumn = (title: string, list: typeof incidents) => {
    return (
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-4 sm:p-5 flex flex-col gap-4 min-h-[360px] md:min-h-[520px] min-w-0">
        <div className="border-b border-irent-line pb-2 mb-1 flex justify-between items-center">
          <h2 className="text-base sm:text-lg font-black text-irent-ink m-0">{title}</h2>
          <span className="text-[11px] font-black rounded-full px-2 py-0.5 bg-irent-soft-red text-irent-red">
            {list.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col gap-2.5">
          {list.length > 0 ? (
            list.map(item => {
              const taskTitle = item.type === "damage" ? "Inspection" : item.type === "cleaning" ? "Cleaning" : "Release";
              return (
                <article 
                  key={item.id} 
                  onClick={() => handleCardClick(item.id)}
                  className="border border-irent-line rounded-2xl p-4 bg-white hover:-translate-y-0.5 hover:shadow-hover hover:border-irent-red/30 cursor-pointer transition-all flex flex-col gap-1.5"
                >
                  <strong className="block text-sm text-irent-ink font-black break-anywhere">
                    {taskTitle} Task · {item.plate}
                  </strong>
                  <p className="text-xs text-irent-muted m-0">{item.station} · {item.label}</p>
                  <p className="text-[11px] text-irent-muted m-0">Priority {item.score} · {item.assignee}</p>
                  <span className="self-start inline-flex items-center text-[10px] font-black rounded-full px-2.5 py-0.5 bg-[#eef2f7] text-[#314154]">
                    {getTaskStatusText(item.status)}
                  </span>
                </article>
              );
            })
          ) : (
            <p className="text-irent-muted text-xs text-center py-10">目前沒有任務</p>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-w-0">
      {renderColumn("待建立任務", todoTasks)}
      {renderColumn("已派工", assignedTasks)}
      {renderColumn("已完成", doneTasks)}
    </div>
  );
};

export default Tasks;
