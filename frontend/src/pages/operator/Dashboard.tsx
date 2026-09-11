import React, { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useApp, Incident } from '../../context/AppContext';
import IncidentQueue, { QueueTab } from '../../components/dashboard/IncidentQueue';
import IncidentDetailPanel from '../../components/dashboard/IncidentDetailPanel';
import ActivityTimeline from '../../components/dashboard/ActivityTimeline';

const Dashboard: React.FC = () => {
  const { state, isLoading, loadError, refreshState, selectedId, setSelectedId, searchQuery, setSearchQuery, apiPost, showToast } = useApp();
  const [severityFilter, setSeverityFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [queueTab, setQueueTab] = useState<QueueTab>('all');
  const [commentText, setCommentText] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportResult, setReportResult] = useState('pass');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const incidents = state?.incidents || [];
  const selected = incidents.find(item => item.id === selectedId) || incidents[0];
  const timeline = selected ? state?.timelines[selected.id] || [] : [];
  const comments = selected ? state?.comments[selected.id] || [] : [];
  const reports = selected ? state?.maintenanceReports[selected.id] || [] : [];

  const runAction = async (action: string, incident: Incident | undefined = selected, extra: Record<string, unknown> = {}) => {
    if (!incident) return;
    if (action === 'dispatch') setDispatchingId(incident.id);
    try {
      await apiPost('/api/action', { action, incidentId: incident.id, ...extra });
      showToast('操作成功', action === 'dispatch' ? `${incident.plate} 已建立派工並通知 LINE。` : `任務狀態已更新：${action}`);
    } catch (error: any) {
      showToast('操作失敗', error.message);
    } finally {
      setDispatchingId(null);
    }
  };

  const handleAddComment = async () => {
    if (!selected || !commentText.trim()) return;
    setCommentSubmitting(true);
    try {
      await apiPost('/api/action', { action: 'comment', incidentId: selected.id, author: '客服', body: commentText.trim() });
      setCommentText('');
      showToast('留言已新增', '客服留言已儲存並排入 LINE 通知。');
    } catch (error: any) {
      showToast('留言失敗', error.message);
    } finally {
      setCommentSubmitting(false);
    }
  };

  const readPhoto = (file: File): Promise<{ name: string; data: string }> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: reader.result as string });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleMaintenanceReport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setReportSubmitting(true);
    const input = document.getElementById('reportPhotoFile') as HTMLInputElement | null;
    const file = input?.files?.[0];
    try {
      const photo = file ? await readPhoto(file) : null;
      const note = reportResult === 'fail' && !reportNote.includes('異常') ? `仍有異常：${reportNote.trim()}` : reportNote.trim();
      await apiPost('/api/action', { action: 'maintenance_report', incidentId: selected.id, note, photo });
      setReportNote('');
      if (input) input.value = '';
      showToast('報告已送出', '小隊回報已提交，AI Review 已執行。');
    } catch (error: any) {
      showToast('提交失敗', error.message);
    } finally {
      setReportSubmitting(false);
    }
  };

  if (isLoading && !state) {
    return <div className="dashboard-loading" aria-label="正在載入 Dashboard">{Array.from({ length: 8 }).map((_, index) => <span key={index} className="skeleton" />)}</div>;
  }

  if (loadError && !state) {
    return <div className="surface-card error-state"><AlertCircle size={34} /><h2>資料載入失敗</h2><p>{loadError}</p><button className="btn btn-primary" onClick={() => refreshState()}><RefreshCw size={16} />重新整理</button></div>;
  }

  return (
    <div className="dashboard-workspace">
      {loadError && <div className="inline-error"><AlertCircle size={15} />{loadError}<button onClick={() => refreshState()}>重試</button></div>}
      <div className="dashboard-columns">
        <IncidentQueue incidents={incidents} photos={state?.uploadedPhotos || []} selectedId={selected?.id || null} onSelect={setSelectedId} onDispatch={incident => runAction('dispatch', incident)} dispatchingId={dispatchingId} searchQuery={searchQuery} onSearch={setSearchQuery} severity={severityFilter} onSeverityChange={setSeverityFilter} type={typeFilter} onTypeChange={setTypeFilter} tab={queueTab} onTabChange={setQueueTab} />
        <aside className="dashboard-side-stack">
          <IncidentDetailPanel incident={selected} photos={state?.uploadedPhotos || []} comments={comments} reports={reports} commentText={commentText} onCommentChange={setCommentText} onCommentSubmit={handleAddComment} commentSubmitting={commentSubmitting} reportNote={reportNote} onReportNoteChange={setReportNote} reportResult={reportResult} onReportResultChange={setReportResult} onReportSubmit={handleMaintenanceReport} reportSubmitting={reportSubmitting} onAction={action => runAction(action)} />
          <ActivityTimeline incidentId={selected?.id} events={timeline} />
        </aside>
      </div>
    </div>
  );
};

export default Dashboard;
