import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  HelpCircle, 
  RefreshCw, 
  Play, 
  XOctagon, 
  Sparkles, 
  UserCheck,
  Send
} from 'lucide-react';

const SEVERITY_TEXT: Record<string, string> = { high: "高優先", medium: "中度", low: "正常/低" };
const TYPE_TEXT: Record<string, string> = { damage: "車損", cleaning: "清潔", normal: "正常" };

const Dashboard: React.FC = () => {
  const { state, selectedId, setSelectedId, apiPost, showToast } = useApp();

  const [severityFilter, setSeverityFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [commentText, setCommentText] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportResult, setReportResult] = useState('pass');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const incidents = state?.incidents || [];
  const selected = incidents.find(i => i.id === selectedId) || incidents[0];

  const filteredIncidents = incidents.filter(item => {
    const severityOk = severityFilter === 'all' || item.severity === severityFilter;
    const typeOk = typeFilter === 'all' || item.type === typeFilter;
    return severityOk && typeOk;
  });

  const getTimeline = () => {
    if (!selected) return [];
    return state?.timelines[selected.id] || [];
  };

  const getComments = () => {
    if (!selected) return [];
    return state?.comments[selected.id] || [];
  };

  const getReports = () => {
    if (!selected) return [];
    return state?.maintenanceReports[selected.id] || [];
  };

  const getLatestReport = () => {
    const list = getReports();
    return list.length > 0 ? list[list.length - 1] : null;
  };

  const getAIReviewSummary = () => {
    if (!selected) return '';
    const report = getLatestReport();
    return selected.aiReviewSummary || report?.ai_review_summary || "等待小隊上傳完修照片後自動執行 AI Review。";
  };

  const getAIReviewResult = () => {
    if (!selected) return 'pending';
    const report = getLatestReport();
    return selected.aiReviewResult || report?.ai_review_result || "pending";
  };

  const getAIReviewConfidence = () => {
    if (!selected) return '-';
    const report = getLatestReport();
    return selected.aiReviewConfidence ?? report?.ai_review_confidence ?? "-";
  };

  const getOutcomeStatus = () => {
    if (!selected) return '';
    if (selected.autoClosed) return "Auto Closed";
    const needsHumanReview = selected.aiReviewResult && (selected.aiReviewResult !== 'pass' || Number(selected.aiReviewConfidence || 0) < 90);
    if (needsHumanReview) return "Need Human Review";
    if (selected.status === 'resolved' || selected.status === 'done') return "Closed";
    if (selected.status === 'assigned') return "Auto Dispatch";
    return "Waiting for Team Upload";
  };

  const getStatusLabel = (item: any) => {
    if (item.autoClosed) return "Auto Closed";
    const needsHumanReview = item.aiReviewResult && (item.aiReviewResult !== 'pass' || Number(item.aiReviewConfidence || 0) < 90);
    if (needsHumanReview) return "Need Human Review";
    if (item.status === 'resolved' || item.status === 'done') return "Closed";
    if (item.status === 'assigned') return "Auto Dispatch";
    return "AI Detect";
  };

  const handleAction = async (action: string, extra: any = {}) => {
    if (!selected) return;
    try {
      await apiPost('/api/action', {
        action,
        incidentId: selected.id,
        ...extra
      });
      showToast("操作成功", `任務狀態已更新: ${action}`);
    } catch (e: any) {
      showToast("操作失敗", e.message);
    }
  };

  const handleAddComment = async () => {
    if (!selected || !commentText.trim()) return;
    setCommentSubmitting(true);
    try {
      await apiPost('/api/action', {
        action: 'comment',
        incidentId: selected.id,
        author: '客服',
        body: commentText.trim()
      });
      setCommentText('');
      showToast("留言已新增", "客服留言已儲存並通知 Slack");
    } catch (e: any) {
      showToast("留言失敗", e.message);
    } finally {
      setCommentSubmitting(false);
    }
  };

  const readPhoto = (file: File): Promise<{ name: string; data: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, data: reader.result as string });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleMaintenanceReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setReportSubmitting(true);

    const fileInput = document.getElementById('reportPhotoFile') as HTMLInputElement;
    const file = fileInput?.files?.[0];

    try {
      const photoData = file ? await readPhoto(file) : null;
      await apiPost('/api/action', {
        action: 'maintenance_report',
        incidentId: selected.id,
        note: reportNote.trim(),
        photo: photoData
      });
      
      setReportNote('');
      if (fileInput) fileInput.value = '';
      
      showToast("報告已送出", "小隊回報已提交，AI Review 已執行");
    } catch (error: any) {
      showToast("提交失敗", error.message);
    } finally {
      setReportSubmitting(false);
    }
  };

  // Timeline / progress steps
  const getProgressSteps = () => {
    if (!selected) return [];
    const hasDispatch = selected.status !== 'todo' || !!selected.assignedTeam;
    const reports = getReports();
    const hasUpload = reports.length > 0;
    const hasReview = !!selected.aiReviewResult;
    const isClosed = selected.status === 'resolved' || selected.status === 'done';

    return [
      { label: "AI Detect", done: true, state: "Done" },
      { label: "Auto Dispatch", done: hasDispatch, state: hasDispatch ? "Done" : "Pending" },
      { label: "Team Upload", done: hasUpload, state: hasUpload ? "Done" : "Pending" },
      { label: "AI Review", done: hasReview, state: hasReview ? (selected.aiReviewResult !== 'pass' ? "Need Human Review" : "Done") : "Pending" },
      { label: "Closed", done: isClosed, state: isClosed ? "Done" : "Pending" }
    ];
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-4 sm:gap-5 items-start min-w-0">
      {/* Incident Queue List */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium overflow-hidden min-w-0">
        <div className="bg-[#fff8f8] border-b border-[#f4d7d7] px-4 sm:px-5 py-4.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h2 className="text-[#222222] text-lg font-black m-0">即時 Incident 佇列</h2>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <select 
              value={severityFilter} 
              onChange={e => setSeverityFilter(e.target.value)}
              className="w-full sm:flex-1 sm:min-w-[132px] h-[38px] border border-irent-line rounded-xl px-2.5 bg-white text-sm font-bold text-irent-ink focus:ring-3 focus:ring-red-100"
              aria-label="嚴重度篩選"
            >
              <option value="all">全部嚴重度</option>
              <option value="high">高優先</option>
              <option value="medium">中度</option>
              <option value="low">正常/低</option>
            </select>
            <select 
              value={typeFilter} 
              onChange={e => setTypeFilter(e.target.value)}
              className="w-full sm:flex-1 sm:min-w-[132px] h-[38px] border border-irent-line rounded-xl px-2.5 bg-white text-sm font-bold text-irent-ink focus:ring-3 focus:ring-red-100"
              aria-label="類型篩選"
            >
              <option value="all">所有類型</option>
              <option value="damage">車損</option>
              <option value="cleaning">清潔</option>
              <option value="normal">正常</option>
            </select>
          </div>
        </div>

        <div className="max-h-[640px] overflow-y-auto divide-y divide-irent-line">
          {filteredIncidents.length > 0 ? (
            filteredIncidents.map(item => {
              const isActive = item.id === selectedId;
              const severityColor = item.severity === 'high' ? 'bg-irent-danger text-white' : item.severity === 'medium' ? 'bg-irent-orange text-irent-ink' : 'bg-irent-green text-white';
              
              return (
                <article 
                  key={item.id} 
                  onClick={() => setSelectedId(item.id)}
                  className={`grid grid-cols-[8px_minmax(0,1fr)] sm:grid-cols-[8px_minmax(0,1fr)_auto] gap-3 px-4 sm:px-5 py-4 cursor-pointer transition-all ${
                    isActive ? 'bg-irent-soft-red border-l-4 border-l-irent-red' : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-2 h-full rounded-full min-h-[78px] ${
                    item.severity === 'high' ? 'bg-irent-danger' : item.severity === 'medium' ? 'bg-irent-orange' : 'bg-irent-green'
                  }`} />
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-irent-ink text-base mb-1">{item.plate}</h3>
                    <p className="text-irent-muted text-xs my-0.5">{item.station} · {TYPE_TEXT[item.type]} · {item.label}</p>
                    <p className="text-irent-muted text-[11px] my-0.5">AI Confidence {item.confidence}% · {item.time} · {SEVERITY_TEXT[item.severity]}</p>
                  </div>
                  <div className={`col-start-2 sm:col-start-auto self-start w-full sm:w-auto sm:min-w-[108px] text-center rounded-full py-2 px-3 flex flex-col items-center justify-center ${severityColor}`}>
                    <strong className="text-xs font-black leading-none">{SEVERITY_TEXT[item.severity]}</strong>
                    <span className="text-[10px] opacity-80 mt-1">Priority {item.score}</span>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="py-20 text-center text-irent-muted">
              目前沒有符合條件的事件。
            </div>
          )}
        </div>
      </section>

      {/* Action / Detail Panel */}
      <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-4 sm:p-5 flex flex-col gap-5 min-w-0">
        <div className="border-b border-irent-line pb-3">
          <h2 className="text-lg font-black text-irent-ink">事件處理面板</h2>
        </div>

        {selected ? (
          <div className="flex flex-col gap-5">
            {/* Photos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className={`h-[130px] rounded-2xl border border-slate-100 flex items-center justify-center text-xs font-bold text-white relative overflow-hidden bg-cover bg-center ${
                selected.type === 'cleaning' 
                  ? 'bg-[radial-gradient(circle_at_72%_64%,#d14a32_0_6,transparent_7),linear-gradient(160deg,#2f3a49_0_38%,#e2e8f0_39%_48%,#64748b_49%_100%)]' 
                  : 'bg-[linear-gradient(35deg,#eeeeee_0%,#ffffff_44%,#d6d6d6_45%,#eeeeee_100%)]'
              }`}>
                <span className="absolute bottom-2.5 left-2.5 bg-irent-red/90 text-white rounded-full px-2.5 py-1 text-xs font-black shadow-sm">AI 偵測</span>
              </div>
              <div className="h-[130px] rounded-2xl border border-slate-100 flex items-center justify-center text-xs font-bold text-white relative overflow-hidden bg-[linear-gradient(35deg,#eeeeee_0%,#ffffff_44%,#d6d6d6_45%,#eeeeee_100%)]">
                <span className="absolute bottom-2.5 left-2.5 bg-irent-red/90 text-white rounded-full px-2.5 py-1 text-xs font-black shadow-sm">小隊回報</span>
              </div>
            </div>

            {/* Info KV List */}
            <div className="grid gap-2 border-b border-irent-line pb-4">
              <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">Incident</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.id}</strong>
              </div>
              <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">車號</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.plate}</strong>
              </div>
              <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">站點</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.station}</strong>
              </div>
              <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">AI 偵測</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.label}</strong>
              </div>
              <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">Priority Score</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.score}</strong>
              </div>
              <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">Status</span>
                <strong className="text-irent-ink text-xs font-extrabold">{getStatusLabel(selected)}</strong>
              </div>
              <div className="flex flex-col sm:flex-row justify-between gap-1 border-b border-dashed border-irent-line pb-2.5">
                <span className="text-irent-muted text-xs">Auto Dispatch</span>
                <strong className="text-irent-ink text-xs font-extrabold">{selected.assignee}</strong>
              </div>
            </div>

            {/* AI Summary */}
            <div className="bg-irent-soft-red border border-[#f0d4d4] rounded-2xl p-3.5 text-xs text-[#3a2a2a] leading-relaxed">
              {selected.type === 'damage' 
                ? `${selected.plate} 在 ${selected.station} 回報 ${selected.label}，AI 信心度 ${selected.confidence}%。建議先由客服比對租前照片與最近租客紀錄，確認後再建立檢修或求償流程。`
                : selected.type === 'cleaning'
                  ? `${selected.plate} 在 ${selected.station} 偵測到 ${selected.label}，下一位預約約 ${selected.nextBooking} 分鐘後。建議立即派最近清潔人員處理，完成後回傳照片更新車況。`
                  : `${selected.plate} 的還車照片已通過檢查，目前可維持上架營運。系統仍會保留紀錄，供後續趨勢分析使用。`
              }
            </div>

            {/* Flow Progress */}
            <div>
              <h3 className="text-sm font-extrabold text-irent-ink mb-2">流程進度</h3>
              <div className="flex gap-3 overflow-x-auto pb-2 scroll-snap-type-x">
                {getProgressSteps().map((step, idx) => {
                  const isCurrent = step.state === "Need Human Review" || (!step.done && (idx === 0 || getProgressSteps()[idx-1].done));
                  return (
                    <div 
                      key={step.label} 
                      className={`flex-shrink-0 w-28 rounded-2xl p-2.5 text-center flex flex-col gap-1 border ${
                        step.done && !isCurrent 
                          ? 'border-[#2e7d32]/24 bg-[#f0f7f1] text-irent-green' 
                          : isCurrent 
                            ? 'border-irent-red bg-irent-red text-white shadow-md' 
                            : 'border-irent-line bg-[#fafafa] text-irent-muted'
                      }`}
                    >
                      <strong className="text-xs font-extrabold">{step.label}</strong>
                      <span className="text-[10px] opacity-80">{step.state}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI Review Panel */}
            <div className={`border rounded-2xl p-3.5 flex flex-col gap-2.5 ${
              getAIReviewResult() === 'pass' 
                ? 'border-[#2e7d32]/28 bg-[#f0f7f1]' 
                : getAIReviewResult() === 'pending'
                  ? 'border-irent-line bg-[#fafafa]'
                  : 'border-[#f9a825]/42 bg-[#fff9e8]'
            }`}>
              <div className="flex justify-between items-center">
                <strong className="text-sm font-extrabold flex items-center gap-1">
                  <Sparkles size={16} />
                  AI Review
                </strong>
                <span className="text-[10px] font-black rounded-full px-2.5 py-0.5 bg-white/60 border border-slate-200">
                  {getOutcomeStatus()}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="bg-white border border-irent-line rounded-xl p-2">
                  <span className="text-irent-muted block text-[10px] mb-0.5">result</span>
                  <strong className="text-irent-ink font-bold">{getAIReviewResult()}</strong>
                </div>
                <div className="bg-white border border-irent-line rounded-xl p-2">
                  <span className="text-irent-muted block text-[10px] mb-0.5">confidence</span>
                  <strong className="text-irent-ink font-bold">
                    {getAIReviewConfidence()}{getAIReviewConfidence() === '-' ? '' : '%'}
                  </strong>
                </div>
              </div>
              <p className="text-xs leading-relaxed m-0 text-slate-700 bg-white/40 p-2.5 rounded-xl border border-slate-100">
                {getAIReviewSummary()}
              </p>
            </div>

            {/* Comment Section */}
            <div className="border-t border-irent-line pt-4">
              <h3 className="text-sm font-extrabold text-irent-ink mb-2">客服與小隊歷程</h3>
              
              {/* Timeline list */}
              <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto mb-3 pl-2.5 border-l-2 border-slate-200">
                {getTimeline().length > 0 ? (
                  getTimeline().map(event => (
                    <div key={event.id} className="text-xs">
                      <strong className="text-irent-ink font-bold">{event.title}</strong>
                      <span className="text-irent-muted block text-[10px] mt-0.5">{event.created_at} · {event.body}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-irent-muted text-xs">尚無紀錄</span>
                )}
              </div>

              {/* Comment list */}
              <div className="flex flex-col gap-2.5 max-h-[180px] overflow-y-auto mb-3">
                {getComments().length > 0 ? (
                  getComments().map(c => (
                    <article key={c.id} className="border border-irent-line rounded-xl p-2.5 bg-slate-50">
                      <strong className="text-irent-ink font-bold text-xs block">{c.author} · {c.created_at}</strong>
                      <p className="text-irent-muted text-xs leading-relaxed mt-1 mb-0">{c.body}</p>
                    </article>
                  ))
                ) : (
                  <p className="text-irent-muted text-xs text-center py-2">目前尚無留言。</p>
                )}
              </div>

              {/* Comment box */}
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea 
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="輸入客服留言，送出後會自動通知 Slack"
                  className="w-full sm:flex-1 min-h-[42px] max-h-[100px] border border-irent-line rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
                />
                <button
                  onClick={handleAddComment}
                  disabled={commentSubmitting || !commentText.trim()}
                  className="w-full sm:w-auto min-h-[42px] px-3 bg-irent-red text-white rounded-xl hover:bg-irent-red-hover transition-all flex items-center justify-center disabled:opacity-50"
                  aria-label="新增客服留言"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>

            {/* Team Report Upload */}
            <div className="border-t border-irent-line pt-4">
              <h3 className="text-sm font-extrabold text-irent-ink mb-2">小隊回報</h3>
              <form onSubmit={handleMaintenanceReport} className="flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
                  <input 
                    type="file" 
                    id="reportPhotoFile" 
                    accept="image/*"
                    className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-irent-soft-red file:text-irent-red hover:file:bg-irent-soft-red-strong cursor-pointer"
                  />
                  <select
                    value={reportResult}
                    onChange={e => setReportResult(e.target.value)}
                    className="w-full sm:w-auto h-[36px] border border-irent-line rounded-xl px-2 bg-white text-xs font-bold text-irent-ink"
                    aria-label="處理結果"
                  >
                    <option value="pass">處理完成，照片通過</option>
                    <option value="fail">仍有異常</option>
                  </select>
                </div>
                <textarea 
                  value={reportNote}
                  onChange={e => setReportNote(e.target.value)}
                  placeholder="備註，例如：已清潔後座並補拍照片。"
                  className="w-full min-h-[56px] border border-irent-line rounded-xl px-3 py-2 text-xs resize-y focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
                />
                <button 
                  type="submit" 
                  disabled={reportSubmitting}
                  className="w-full min-h-[38px] rounded-xl bg-irent-red text-white text-xs font-bold hover:bg-irent-red-hover transition-all disabled:opacity-50"
                >
                  {reportSubmitting ? '提交中...' : '提交回報'}
                </button>
              </form>
            </div>

            {/* Control Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-irent-line pt-4">
              <button 
                onClick={() => handleAction('dispatch')}
                className="w-full min-h-[44px] rounded-xl border border-irent-red text-irent-red bg-white font-extrabold text-xs hover:shadow-hover transition-all flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={14} />
                重新派工
              </button>
              <button 
                onClick={() => handleAction('in_progress')}
                className="w-full min-h-[44px] rounded-xl border border-irent-red text-irent-red bg-white font-extrabold text-xs hover:shadow-hover transition-all flex items-center justify-center gap-1.5"
              >
                <Play size={14} />
                任務開始
              </button>
              
              {selected.aiReviewResult && (selected.aiReviewResult !== 'pass' || Number(selected.aiReviewConfidence || 0) < 90) && (
                <button 
                  onClick={() => handleAction('resolve')}
                  className="sm:col-span-2 w-full min-h-[44px] rounded-xl border border-irent-orange text-irent-orange bg-white font-extrabold text-xs hover:shadow-hover transition-all flex items-center justify-center gap-1.5"
                >
                  <UserCheck size={14} />
                  人工確認結案
                </button>
              )}

              <button 
                onClick={() => handleAction('reopen')}
                className="sm:col-span-2 w-full min-h-[34px] rounded-xl border border-transparent text-irent-muted font-bold text-xs hover:bg-irent-soft-red hover:text-irent-red transition-all flex items-center justify-center gap-1"
              >
                <XOctagon size={13} />
                Reopen Incident
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-20 text-irent-muted flex flex-col items-center justify-center gap-2">
            <HelpCircle size={40} className="text-irent-line" />
            無選取事件
          </div>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
