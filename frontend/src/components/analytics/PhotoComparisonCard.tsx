import React, { useMemo, useState } from 'react';
import { Images, ScanSearch } from 'lucide-react';
import { UploadedPhoto, useApp } from '../../context/AppContext';

interface VisionResult {
  comparisonType: string;
  decision: 'pass' | 'needs_more_evidence' | 'human_review';
  confidence: number;
  summary: string;
  suspectedRegions: Array<{ label: string; description: string }>;
  evidence: string[];
}

const PhotoComparisonCard: React.FC<{ photos: UploadedPhoto[] }> = ({ photos }) => {
  const { apiPost } = useApp();
  const available = useMemo(() => photos.filter(photo => Boolean(photo.filePath)), [photos]);
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');
  const [review, setReview] = useState<VisionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const compare = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await apiPost('/api/agent/photo-compare', { beforePhotoId: beforeId, afterPhotoId: afterId });
      setReview(result.review);
    } catch (requestError: any) {
      setError(requestError.message || '照片比較失敗。');
    } finally {
      setBusy(false);
    }
  };

  const option = (photo: UploadedPhoto) => `${photo.plate} · ${photo.slot} · ${photo.phase} · ${photo.photoId}`;
  return (
    <section className="surface-card photo-comparison-card">
      <header><div><span className="eyebrow">VISION REVIEW</span><h2>租前／租後照片比較</h2></div><Images size={18} /></header>
      <p>只可選擇已驗證並由後端保存的照片；車牌與拍攝位置必須一致。</p>
      <div className="photo-comparison-form">
        <label>較早照片<select value={beforeId} onChange={event => setBeforeId(event.target.value)}><option value="">請選擇</option>{available.map(photo => <option key={photo.photoId} value={photo.photoId}>{option(photo)}</option>)}</select></label>
        <label>較晚照片<select value={afterId} onChange={event => setAfterId(event.target.value)}><option value="">請選擇</option>{available.map(photo => <option key={photo.photoId} value={photo.photoId}>{option(photo)}</option>)}</select></label>
        <button type="button" disabled={busy || !beforeId || !afterId || beforeId === afterId} onClick={() => void compare()}><ScanSearch size={14} />{busy ? '分析中…' : '開始比較'}</button>
      </div>
      {error && <div className="inline-error">{error}</div>}
      {review && <article className={`vision-result is-${review.decision}`}><header><strong>{review.decision === 'pass' ? '通過' : review.decision === 'needs_more_evidence' ? '需補件' : '人工確認'}</strong><b>{review.confidence}%</b></header><p>{review.summary}</p>{review.suspectedRegions.map(region => <span key={`${region.label}-${region.description}`}><b>{region.label}</b> {region.description}</span>)}<small>{review.evidence.join('；')}</small></article>}
    </section>
  );
};

export default PhotoComparisonCard;
