import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
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
}

const STATUS_TEXT: Record<string, string> = {
  todo: 'Need Dispatch', assigned: 'Auto Dispatch', in_progress: 'In Progress', waiting_review: 'Need Human Review', resolved: 'Closed', done: 'Closed'
};

const IncidentDetailPanel: React.FC<IncidentDetailPanelProps> = props => {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const matchingPhotos = useMemo(() => props.incident ? props.photos.filter(photo => photo.plate === props.incident?.plate && photo.filePath).slice(0, 4) : [], [props.incident, props.photos]);

  useEffect(() => { setPreview(null); }, [props.incident?.id]);

  if (!props.incident) {
    return <section className="surface-card incident-detail empty-state incident-detail--empty"><HelpCircle size={36} /><strong>尚未選取事件</strong><span>從左側 Incident 佇列選擇事件查看詳情。</span></section>;
  }

  const incident = props.incident;
  const latestReport = props.reports[props.reports.length - 1];
  const reviewResult = incident.aiReviewResult || latestReport?.ai_review_result || 'pending';
  const reviewConfidence = incident.aiReviewConfidence ?? latestReport?.ai_review_confidence;
  const status = incident.autoClosed ? 'Auto Closed' : STATUS_TEXT[incident.status] || incident.status;
  const completed = ['resolved', 'done'].includes(incident.status);

  const metadata = [
    ['車號', incident.plate], ['站點', incident.station], ['事件類型', incident.label], ['AI 信心度', `${incident.confidence}%`],
    ['Priority Score', String(incident.score)], ['狀態', status], ['建立時間', incident.time], ['資料來源', matchingPhotos.length ? 'User Upload (App)' : 'AI Operations']
  ];

  return (
    <section className="surface-card incident-detail">
      <header className="incident-detail__header"><div><span className="eyebrow">INCIDENT COMMAND</span><h2>事件處理面板</h2></div><span className="live-badge"><span />即時更新</span></header>

      <div className="incident-gallery">
        <button type="button" className="incident-gallery__main" onClick={() => matchingPhotos[0]?.filePath && setPreview(`/${matchingPhotos[0].filePath}`)}>
          {matchingPhotos[0]?.filePath ? <img src={`/${matchingPhotos[0].filePath}`} alt={`${incident.plate} AI 偵測`} /> : <div className={`vehicle-placeholder vehicle-placeholder--${incident.type}`}><span>iRent AI</span><b>{incident.type === 'damage' ? '車損影像' : incident.type === 'cleaning' ? '清潔影像' : '驗車影像'}</b></div>}
          <span className="ai-detected"><Sparkles size={12} />AI 偵測</span>
          {matchingPhotos[0]?.filePath && <Expand className="gallery-expand" size={16} />}
        </button>
        <div className="incident-gallery__thumbs">
          {[1, 2, 3].map(index => <button type="button" key={index} onClick={() => matchingPhotos[index]?.filePath && setPreview(`/${matchingPhotos[index].filePath}`)}>{matchingPhotos[index]?.filePath ? <img src={`/${matchingPhotos[index].filePath}`} alt={`${incident.plate} 照片 ${index + 1}`} /> : <div className="gallery-empty">{index === 3 ? `+${Math.max(0, matchingPhotos.length - 3)}` : 'AI'}</div>}</button>)}
        </div>
      </div>

      <div className="incident-detail__identity"><div><strong>{incident.id}</strong><span>{incident.station} · {incident.label}</span></div><span className={`incident-badge incident-badge--${completed ? 'success' : incident.severity === 'high' ? 'danger' : 'warning'}`}>INCIDENT · {completed ? 'PASS' : incident.severity === 'high' ? 'FAIL' : 'REVIEW'}</span></div>

      <dl className="metadata-list">{metadata.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>

      <div className="detail-actions">
        <button type="button" className="btn btn-primary" onClick={() => props.onAction('dispatch')}><RefreshCw size={16} />派發任務</button>
        <button type="button" className="btn btn-secondary" onClick={() => setToolsOpen(value => !value)}><MessageSquareText size={16} />完整處理工具<ChevronDown size={15} className={toolsOpen ? 'rotate-180' : ''} /></button>
      </div>

      <div className={`ai-review-strip ai-review-strip--${reviewResult}`}><Sparkles size={17} /><div><strong>AI Review · {reviewResult}</strong><span>{incident.aiReviewSummary || latestReport?.ai_review_summary || '等待小隊上傳完工照片後自動複檢。'}</span></div>{reviewConfidence !== null && reviewConfidence !== undefined && <b>{reviewConfidence}%</b>}</div>

      {toolsOpen && (
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

      {completed && <div className="closed-notice"><CheckCircle2 size={16} />此 Incident 已完成處理，可透過完整處理工具重新開案。</div>}

      {preview && <div className="image-preview" role="dialog" aria-modal="true" onClick={() => setPreview(null)}><button type="button" aria-label="關閉圖片預覽"><X size={20} /></button><img src={preview} alt={`${incident.plate} 大圖預覽`} onClick={event => event.stopPropagation()} /></div>}
    </section>
  );
};

export default IncidentDetailPanel;
