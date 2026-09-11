import React from 'react';
import { CarFront, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { Incident, UploadedPhoto } from '../../context/AppContext';

export type QueueTab = 'all' | 'todo' | 'processing' | 'done';

interface IncidentQueueProps {
  incidents: Incident[];
  photos: UploadedPhoto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDispatch: (incident: Incident) => void;
  dispatchingId: string | null;
  searchQuery: string;
  onSearch: (value: string) => void;
  severity: string;
  onSeverityChange: (value: string) => void;
  type: string;
  onTypeChange: (value: string) => void;
  tab: QueueTab;
  onTabChange: (value: QueueTab) => void;
}

const isDone = (incident: Incident) => ['resolved', 'done'].includes(incident.status);
const isTodo = (incident: Incident) => incident.status === 'todo';
const isProcessing = (incident: Incident) => !isDone(incident) && !isTodo(incident);

const TYPE_TEXT: Record<string, string> = { damage: '車損', cleaning: '清潔', normal: '正常' };
const STATUS_TEXT: Record<string, string> = {
  todo: '待派工', assigned: '已派工', in_progress: '處理中', waiting_review: '待複檢', resolved: '已完成', done: '已完成'
};

const IncidentQueue: React.FC<IncidentQueueProps> = props => {
  const counts = {
    all: props.incidents.length,
    todo: props.incidents.filter(isTodo).length,
    processing: props.incidents.filter(isProcessing).length,
    done: props.incidents.filter(isDone).length
  };

  const normalized = props.searchQuery.trim().toLowerCase();
  const filtered = props.incidents.filter(item => {
    const tabMatch = props.tab === 'all' || (props.tab === 'todo' && isTodo(item)) || (props.tab === 'processing' && isProcessing(item)) || (props.tab === 'done' && isDone(item));
    const severityMatch = props.severity === 'all' || item.severity === props.severity;
    const typeMatch = props.type === 'all' || item.type === props.type;
    const searchMatch = !normalized || [item.id, item.plate, item.station, item.label, item.assignee].some(value => String(value || '').toLowerCase().includes(normalized));
    return tabMatch && severityMatch && typeMatch && searchMatch;
  });

  const tabs: { key: QueueTab; label: string }[] = [
    { key: 'all', label: '全部' }, { key: 'todo', label: '待派工' }, { key: 'processing', label: '處理中' }, { key: 'done', label: '已完成' }
  ];

  return (
    <section className="surface-card incident-queue">
      <header className="incident-queue__header">
        <div>
          <span className="eyebrow">LIVE OPERATIONS</span>
          <h2>即時 Incident 佇列</h2>
        </div>
        <div className="incident-filters">
          <label><SlidersHorizontal size={15} /><select value={props.severity} onChange={event => props.onSeverityChange(event.target.value)} aria-label="嚴重度篩選"><option value="all">全部嚴重度</option><option value="high">高優先</option><option value="medium">中度</option><option value="low">正常／低</option></select></label>
          <label><select value={props.type} onChange={event => props.onTypeChange(event.target.value)} aria-label="事件類型篩選"><option value="all">所有類型</option><option value="damage">車損</option><option value="cleaning">清潔</option><option value="normal">正常</option></select></label>
        </div>
      </header>

      <div className="queue-tabs" role="tablist" aria-label="Incident 狀態">
        {tabs.map(item => <button type="button" key={item.key} role="tab" aria-selected={props.tab === item.key} className={props.tab === item.key ? 'active' : ''} onClick={() => props.onTabChange(item.key)}>{item.label} <span>({counts[item.key]})</span></button>)}
      </div>

      <label className="queue-search"><Search size={17} /><input value={props.searchQuery} onChange={event => props.onSearch(event.target.value)} placeholder="搜尋車號、位置或事件描述…" aria-label="搜尋事件佇列" /></label>

      <div className="incident-list">
        {filtered.map(item => {
          const active = item.id === props.selectedId;
          const done = isDone(item);
          const tone = item.severity === 'high' ? 'danger' : item.severity === 'medium' ? 'warning' : 'success';
          const photo = props.photos.find(candidate => candidate.plate === item.plate && candidate.filePath);
          return (
            <article key={item.id} className={`incident-row incident-row--${tone} ${active ? 'active' : ''}`} onClick={() => props.onSelect(item.id)} tabIndex={0} onKeyDown={event => event.key === 'Enter' && props.onSelect(item.id)}>
              <div className="incident-row__media">
                {photo?.filePath ? <img src={`/${photo.filePath}`} alt={`${item.plate} 驗車照片`} /> : <CarFront size={25} />}
              </div>
              <div className="incident-row__main">
                <div className="incident-row__title"><span className={`status-mark status-mark--${tone}`}>{done ? '✓' : '!'}</span><strong>{done || item.type === 'normal' ? 'PASS' : item.severity === 'high' ? 'FAIL' : STATUS_TEXT[item.status] || 'REVIEW'}</strong><b>{item.plate}</b></div>
                <p>{item.station} · {TYPE_TEXT[item.type] || item.type} · {item.label}</p>
                <small>AI Confidence {item.confidence}% · {item.time}</small>
              </div>
              <div className="incident-row__time">{item.nextBooking <= 30 ? `${item.nextBooking} 分鐘內` : STATUS_TEXT[item.status]}</div>
              <span className={`priority-badge priority-badge--${tone}`}>{item.severity === 'high' ? '高優先' : item.severity === 'medium' ? '中優先' : '正常'}</span>
              <button type="button" className={done ? 'row-action row-action--secondary' : 'row-action'} disabled={props.dispatchingId === item.id} onClick={event => { event.stopPropagation(); done ? props.onSelect(item.id) : props.onDispatch(item); }}>
                {props.dispatchingId === item.id ? '處理中…' : done ? '查看詳情' : '派發任務'} <ChevronRight size={15} />
              </button>
            </article>
          );
        })}
        {!filtered.length && <div className="empty-state"><Search size={30} /><strong>目前沒有 Incident</strong><span>調整篩選條件或搜尋關鍵字後再試一次。</span></div>}
      </div>
    </section>
  );
};

export default IncidentQueue;
