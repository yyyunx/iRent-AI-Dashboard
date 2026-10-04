import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Expand,
  HelpCircle,
  MessageSquareText,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Upload,
  UserCheck,
  X,
  XOctagon
} from 'lucide-react';
import { CommentItem, Incident, MaintenanceReportItem, UploadedPhoto } from '../../context/AppContext';
import UrgencyBadge from './UrgencyBadge';

interface IncidentDetailPanelProps {
  incident?: Incident;
  photos: UploadedPhoto[];
  comments: CommentItem[];
  reports: MaintenanceReportItem[];
  commentText: string;
  onCommentChange: (value: string) => void;
  onCommentSubmit: () => void;
  commentSubmitting: boolean;
  reportNote: string;
  onReportNoteChange: (value: string) => void;
  reportResult: string;
  onReportResultChange: (value: string) => void;
  onReportSubmit: (event: React.FormEvent) => void;
  reportSubmitting: boolean;
  onAction: (action: string) => void;
  canManage: boolean;
}

const STATUS_TEXT: Record<string, string> = {
  todo: '待派工', assigned: '已派工', in_progress: 'In Progress', waiting_review: 'Need Human Review', resolved: 'Closed', done: 'Closed'
};

const IncidentDetailPanel: React.FC<IncidentDetailPanelProps> = props => {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const matchingPhotos = useMemo(() => props.incident?.sourceSubmissionId ? props.photos.filter(photo => photo.submissionId === props.incident?.sourceSubmissionId && photo.filePath) : [], [props.incident, props.photos]);

  useEffect(() => { setPreview(null); }, [props.incident?.id]);

  useEffect(() => {
    if (preview === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null);
      if (event.key === 'ArrowLeft') setPreview(index => index === null ? null : Math.max(0, index - 1));
      if (event.key === 'ArrowRight') setPreview(index => index === null ? null : Math.min(matchingPhotos.length - 1, index + 1));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preview, matchingPhotos.length]);

  if (!props.incident) {
    return <section className="surface-card incident-detail empty-state incident-detail--empty"><HelpCircle size={36} /><strong>尚未選取事件</strong><span>從左側 Incident 佇列選擇事件查看詳情。</span></section>;
  }

  const incident = props.incident;
  const latestReport = props.reports[props.reports.length - 1];
  const reviewResult = incident.aiReviewResult || latestReport?.ai_review_result || 'pending';
  const reviewConfidence = incident.aiReviewConfidence ?? latestReport?.ai_review_confidence;
  const status = incident.autoClosed ? 'Auto Closed' : STATUS_TEXT[incident.status] || incident.status;
  const completed = ['resolved', 'done'].includes(incident.status);
  const thumbnailPhotos = matchingPhotos.slice(1, 3);
  const hiddenPhotoCount = Math.max(0, matchingPhotos.length - 3);
  const thumbnailCount = thumbnailPhotos.length + (hiddenPhotoCount > 0 ? 1 : 0);

  const metadata = [
    ['車號', incident.plate], ['站點', incident.station], ['事件類型', incident.label], ['AI 信心度', `${incident.confidence}%`],
    ['Priority Score', String(incident.score)], ['狀態', status], ['負責人', incident.assignee], ['建立時間', incident.time], ['資料來源', matchingPhotos.length ? 'User Upload (App)' : 'AI Operations']
  ];

  return (
    <section className="surface-card incident-detail">
      <header className="incident-detail__header"><div><span className="eyebrow">INCIDENT COMMAND</span><h2>事件處理面板</h2></div><span className="live-badge"><span />即時更新</span></header>

      <div className="incident-detail__identity"><div><strong title={incident.id}>{incident.id}</strong><span>{incident.station} · {incident.time}</span><small>{incident.label}</small></div><span className={`incident-badge incident-badge--${completed ? 'success' : incident.severity === 'high' ? 'danger' : 'warning'}`}>INCIDENT · {completed ? 'PASS' : incident.severity === 'high' ? 'FAIL' : 'REVIEW'}</span></div>

      <div className={`incident-gallery${thumbnailCount ? '' : ' incident-gallery--single'}`}>
        <button type="button" className="incident-gallery__main" aria-label={matchingPhotos[0]?.filePath ? '開啟主要照片預覽' : '目前沒有事件照片'} onClick={() => matchingPhotos[0]?.filePath && setPreview(0)}>
          {matchingPhotos[0]?.filePath ? <img src={`/${matchingPhotos[0].filePath}`} alt={`${incident.plate} AI 偵測`} /> : <div className={`vehicle-placeholder vehicle-placeholder--${incident.type}`}><span>iRent AI</span><b>{incident.type === 'damage' ? '車損影像' : incident.type === 'cleaning' ? '清潔影像' : '驗車影像'}</b></div>}
          <span className="ai-detected"><Sparkles size={12} />AI 偵測</span>
          {matchingPhotos[0]?.filePath && <Expand className="gallery-expand" size={16} />}
        </button>
        {thumbnailCount > 0 && <div className={`incident-gallery__thumbs incident-gallery__thumbs--${thumbnailCount}`}>
          {thumbnailPhotos.map((photo, index) => <button type="button" key={photo.photoId} aria-label={`開啟照片 ${index + 2} 預覽`} onClick={() => setPreview(index + 1)}><img src={`/${photo.filePath}`} alt={`${incident.plate} 照片 ${index + 2}`} /></button>)}
          {hiddenPhotoCount > 0 && <button type="button" className="incident-gallery__more" aria-label={`查看其餘 ${hiddenPhotoCount} 張照片`} onClick={() => setPreview(3)}><img src={`/${matchingPhotos[3].filePath}`} alt="" /><span>+{hiddenPhotoCount}</span></button>}
        </div>}
      </div>

      <dl className="metadata-list">{metadata.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="urgency-summary"><UrgencyBadge score={incident.urgencyScore} issueCount={incident.issueCount} /><span>{incident.issueCount ? `${incident.issueCount} 個異常項目 · 每項加 1，最高 10` : '既有案件依嚴重度換算'}</span></div>

      {props.canManage && <div className="detail-actions">
        <button type="button" className="btn btn-primary" disabled={!['todo', 'assigned'].includes(incident.status)} onClick={() => props.onAction('dispatch')}><RefreshCw size={16} />派發任務</button>
        <button type="button" className="btn btn-secondary" onClick={() => setToolsOpen(value => !value)}><MessageSquareText size={16} />完整處理工具<ChevronDown size={15} className={toolsOpen ? 'rotate-180' : ''} /></button>
      </div>}

      <div className={`ai-review-strip ai-review-strip--${reviewResult}`}><Sparkles size={17} /><div><strong>AI Review · {reviewResult}</strong><span>{incident.aiReviewSummary || latestReport?.ai_review_summary || '等待小隊上傳完工照片後自動複檢。'}</span></div>{reviewConfidence !== null && reviewConfidence !== undefined && <b>{reviewConfidence}%</b>}</div>

      {props.canManage && toolsOpen && (
        <div className="detail-tools">
          <div className="tool-actions">
            <button type="button" onClick={() => props.onAction('in_progress')}><Play size={15} />任務開始</button>
            {(incident.manualReviewRequired || reviewResult === 'fail') && <button type="button" onClick={() => props.onAction('resolve')}><UserCheck size={15} />人工確認結案</button>}
            <button type="button" onClick={() => props.onAction('reopen')}><XOctagon size={15} />重新開案</button>
          </div>

          <form className="report-form" onSubmit={props.onReportSubmit}>
            <h3><Upload size={15} />小隊完工回報</h3>
            <div className="report-form__row"><input type="file" id="reportPhotoFile" accept="image/*" aria-label="上傳完工照片" /><select value={props.reportResult} onChange={event => props.onReportResultChange(event.target.value)} aria-label="回報結果"><option value="pass">處理完成</option><option value="fail">仍有異常</option></select></div>
            <textarea value={props.reportNote} onChange={event => props.onReportNoteChange(event.target.value)} placeholder="備註，例如：已完成清潔並補拍照片。" aria-label="回報備註" />
            <button type="submit" className="btn btn-primary" disabled={props.reportSubmitting}>{props.reportSubmitting ? '提交中…' : '提交回報'}</button>
          </form>

          <div className="comment-panel">
            <h3><MessageSquareText size={15} />客服與小隊留言</h3>
            <div className="comment-list">{props.comments.length ? props.comments.slice(-4).reverse().map(comment => <article key={comment.id}><strong>{comment.author}</strong><time>{comment.created_at}</time><p>{comment.body}</p></article>) : <span>目前尚無留言。</span>}</div>
            <div className="comment-compose"><textarea id="commentText" value={props.commentText} onChange={event => props.onCommentChange(event.target.value)} placeholder="輸入留言，送出後會自動通知 LINE" aria-label="留言內容" /><button type="button" onClick={props.onCommentSubmit} disabled={props.commentSubmitting || !props.commentText.trim()} aria-label="送出留言"><Send size={16} /></button></div>
          </div>
        </div>
      )}

      {completed && <div className="closed-notice"><CheckCircle2 size={16} />{props.canManage ? '此 Incident 已完成處理，可透過完整處理工具重新開案。' : '此 Incident 已完成處理。'}</div>}

      {preview !== null && matchingPhotos[preview]?.filePath && createPortal(<div className="image-preview" role="dialog" aria-modal="true" aria-label="事件照片預覽" onClick={() => setPreview(null)}>
        <button type="button" aria-label="關閉圖片預覽" autoFocus onClick={() => setPreview(null)}><X size={20} /></button>
        <img src={`/${matchingPhotos[preview].filePath}`} alt={`${incident.plate} 照片 ${preview + 1} 大圖預覽`} onClick={event => event.stopPropagation()} />
        {matchingPhotos.length > 1 && <>
          <button type="button" className="image-preview__previous" aria-label="上一張照片" disabled={preview === 0} onClick={event => { event.stopPropagation(); setPreview(preview - 1); }}><ChevronLeft size={24} /></button>
          <button type="button" className="image-preview__next" aria-label="下一張照片" disabled={preview === matchingPhotos.length - 1} onClick={event => { event.stopPropagation(); setPreview(preview + 1); }}><ChevronRight size={24} /></button>
          <span className="image-preview__count">{preview + 1} / {matchingPhotos.length}</span>
        </>}
      </div>, document.body)}
    </section>
  );
};

export default IncidentDetailPanel;
