import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useApp, Incident } from '../../context/AppContext';
import IncidentQueue, { QueueTab } from '../../components/dashboard/IncidentQueue';
import IncidentDetailPanel from '../../components/dashboard/IncidentDetailPanel';
import ActivityTimeline from '../../components/dashboard/ActivityTimeline';
import { useAuth } from '../../context/AuthContext';

const Dashboard: React.FC = () => {
  const { state, isLoading, loadError, refreshState, selectedId, setSelectedId, searchQuery, setSearchQuery, apiPost, showToast } = useApp();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'operator';
  const canAssignOthers = user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const linkedId = params.get('incidentId');
  const intent = params.get('intent');
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [operators, setOperators] = useState<Array<{ id: number; username: string }>>([]);
  const [operatorError, setOperatorError] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
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
  const selected = linkedId ? incidents.find(item => item.id === linkedId) : incidents.find(item => item.id === selectedId) || incidents[0];
  const timeline = selected ? state?.timelines[selected.id] || [] : [];
  const comments = selected ? state?.comments[selected.id] || [] : [];
  const reports = selected ? state?.maintenanceReports[selected.id] || [] : [];

  useEffect(() => {
    if (linkedId) setSelectedId(linkedId);
    setDispatchOpen(intent === 'assign' || intent === 'assign_self' || intent === 'start');
    setAssigneeUserId('');
  }, [linkedId, intent, setSelectedId]);

  useEffect(() => {
    if (!canAssignOthers || !dispatchOpen) return;
    const controller = new AbortController();
    setOperatorError('');
    fetch('/api/operators', { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('無法載入可派工人員');
        const data = await response.json();
        setOperators(data.users);
      }).catch(error => { if (error.name !== 'AbortError') setOperatorError(error.message); });
    return () => controller.abort();
  }, [canAssignOthers, dispatchOpen]);

  const selectIncident = (id: string) => {
    setSelectedId(id);
    setParams({ incidentId: id });
    setDispatchOpen(false);
    setAssigneeUserId('');
  };

  const openDispatch = (incident: Incident) => {
    setSelectedId(incident.id);
    setParams({ incidentId: incident.id, intent: 'assign' });
    setAssigneeUserId('');
    setDispatchOpen(true);
  };

  const runAction = async (action: string, incident: Incident | undefined = selected, extra: Record<string, unknown> = {}) => {
    if (!incident) return;
    setDispatchingId(incident.id);
    try {
      await apiPost('/api/action', { action, incidentId: incident.id, ...extra });
      showToast('操作成功', ['dispatch', 'assign_self'].includes(action) ? `${incident.plate} 派工已儲存；LINE 發送狀態請至通知紀錄查看。` : `任務狀態已更新：${action}`);
      setDispatchOpen(false);
      if (intent) setParams({ incidentId: incident.id });
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
      {linkedId && !selected && state && <div className="inline-error" role="alert">找不到連結中的案件。<button onClick={() => setParams({})}>返回案件清單</button></div>}
      {loadError && <div className="inline-error"><AlertCircle size={15} />{loadError}<button onClick={() => refreshState()}>重試</button></div>}
      <div className="dashboard-columns">
        <IncidentQueue incidents={incidents} photos={state?.uploadedPhotos || []} selectedId={selected?.id || null} onSelect={selectIncident} onDispatch={openDispatch} dispatchingId={dispatchingId} searchQuery={searchQuery} onSearch={setSearchQuery} severity={severityFilter} onSeverityChange={setSeverityFilter} type={typeFilter} onTypeChange={setTypeFilter} tab={queueTab} onTabChange={setQueueTab} canManage={canManage} />
        <aside className="dashboard-side-stack">
          <IncidentDetailPanel incident={selected} photos={state?.uploadedPhotos || []} comments={comments} reports={reports} commentText={commentText} onCommentChange={setCommentText} onCommentSubmit={handleAddComment} commentSubmitting={commentSubmitting} reportNote={reportNote} onReportNoteChange={setReportNote} reportResult={reportResult} onReportResultChange={setReportResult} onReportSubmit={handleMaintenanceReport} reportSubmitting={reportSubmitting} onAction={action => action === 'dispatch' && selected ? openDispatch(selected) : runAction(action)} canManage={canManage} />
          {canManage && dispatchOpen && selected && <section className="surface-card dispatch-panel" aria-label="案件派工">
            <h3>派工 · {selected.plate}</h3>
            <p>目前負責人：{selected.assignee}。選擇人員後按下按鈕確認派工。</p>
            {intent === 'start' && <button className="btn btn-primary" disabled={selected.status !== 'assigned' || Boolean(dispatchingId) || Boolean(selected.assignedUserId && selected.assignedUserId !== user?.id)} onClick={() => runAction('in_progress')}>確認開始處理</button>}
            {!['todo', 'assigned'].includes(selected.status) ? <p role="alert">此案件已開始處理或結案，目前無法派工。</p> : <>
              <button className="btn btn-primary" disabled={Boolean(dispatchingId) || Boolean(selected.assignedUserId && selected.assignedUserId !== user?.id)} onClick={() => runAction('assign_self')}>指派給自己（{user?.username}）</button>
              {canAssignOthers && <>{operatorError && <p role="alert">{operatorError}</p>}
              <label className="dispatch-select">指定負責人<select aria-label="指定負責人" value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}><option value="">選擇營運人員</option>{operators.map(operator => <option key={operator.id} value={operator.id}>{operator.username}</option>)}</select></label>
              <button className="btn btn-secondary" disabled={!assigneeUserId || Boolean(dispatchingId)} onClick={() => runAction('dispatch', selected, { assigneeUserId: Number(assigneeUserId) })}>確認指定人員</button>
              <button className="btn btn-secondary" disabled={Boolean(dispatchingId) || Boolean(selected.assignedUserId)} onClick={() => runAction('dispatch')}>派到{selected.assignedTeam || '區域小隊'}</button></>}
            </>}
            <button className="btn btn-secondary" onClick={() => { setDispatchOpen(false); setParams({ incidentId: selected.id }); }}>取消</button>
          </section>}
          <ActivityTimeline incidentId={selected?.id} events={timeline} />
        </aside>
      </div>
    </div>
  );
};

export default Dashboard;
