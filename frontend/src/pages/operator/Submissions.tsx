import React, { useState } from 'react';
import { useApp, type UploadedPhoto } from '../../context/AppContext';
import { CheckCircle2, AlertTriangle, HelpCircle, Eye, X, XCircle, LoaderCircle, CircleMinus } from 'lucide-react';

type DamageView = {
  schemaVersion: string | null;
  damageStatus: string | null;
  inferenceStatus: string | null;
  detectionCount: number | null;
  confidence: number | null;
  detections: unknown[];
  failureReason: string | null;
  checkedAt: string | null;
};

const INTERIOR_SLOT_MARKERS = ['interior', 'cabin', 'seat', 'dashboard'];

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const booleanValue = (value: unknown) => typeof value === 'boolean' ? value : null;

const getDamageView = (photo: UploadedPhoto): DamageView => {
  const aiResult = asRecord(photo.aiResult);
  const nestedDamage = asRecord(aiResult?.damage);
  const legacyDamage = aiResult && ('damage_status' in aiResult || 'inference_status' in aiResult) ? aiResult : null;
  const raw = nestedDamage || legacyDamage;
  const detections = Array.isArray(raw?.detections) ? raw.detections : [];
  const damageStatus = stringValue(raw?.damage_status);
  const explicitCount = numberValue(raw?.detection_count);

  if (raw) {
    return {
      schemaVersion: stringValue(raw.schema_version),
      damageStatus,
      inferenceStatus: stringValue(raw.inference_status),
      detectionCount: explicitCount ?? (detections.length > 0 ? detections.length : damageStatus === 'none' ? 0 : null),
      confidence: numberValue(raw.confidence),
      detections,
      failureReason: stringValue(raw.failure_reason),
      checkedAt: stringValue(raw.checked_at) || photo.condition?.checkedAt || null
    };
  }

  const legacyDetected = photo.condition?.damageDetected;
  return {
    schemaVersion: null,
    damageStatus: legacyDetected === true ? 'detected' : legacyDetected === false ? 'none' : null,
    inferenceStatus: legacyDetected === null || legacyDetected === undefined ? null : 'success',
    detectionCount: legacyDetected === false ? 0 : null,
    confidence: photo.condition?.damageConfidence ?? null,
    detections: [],
    failureReason: null,
    checkedAt: photo.condition?.checkedAt || null
  };
};

const formatLocalTime = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
};

const isPlateApplicable = (slot: string) => {
  const normalized = slot.trim().toLowerCase();
  return !INTERIOR_SLOT_MARKERS.some(marker => normalized.includes(marker));
};

const technicalValue = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value);

const QualityLine: React.FC<{ passed: boolean | null; success: string; warning: string; pending?: string }> = ({ passed, success, warning, pending = '尚未檢查' }) => {
  if (passed === null) return <div className="flex items-center gap-1.5 text-slate-500"><CircleMinus size={14} className="shrink-0" /><span>{pending}</span></div>;
  return passed
    ? <div className="flex items-center gap-1.5 text-irent-green"><CheckCircle2 size={14} className="shrink-0" /><span>{success}</span></div>
    : <div className="flex items-center gap-1.5 text-[#8a5b00]"><AlertTriangle size={14} className="shrink-0" /><span>{warning}</span></div>;
};

const DamageResult: React.FC<{ photo: UploadedPhoto }> = ({ photo }) => {
  const damage = getDamageView(photo);
  const processing = ['pending', 'processing', 'running'].includes(damage.inferenceStatus || '');
  const failed = damage.inferenceStatus === 'failed';
  const succeeded = damage.inferenceStatus === 'success'
    || (!damage.inferenceStatus && ['none', 'detected'].includes(damage.damageStatus || ''));
  const detected = succeeded && damage.damageStatus === 'detected';
  const noDamage = succeeded && damage.damageStatus === 'none';

  const summary = failed
    ? { icon: <XCircle size={16} />, text: 'AI 分析失敗', className: 'border-red-100 bg-red-50 text-red-700' }
    : processing
      ? { icon: <LoaderCircle size={16} className="animate-spin" />, text: 'AI 分析中…', className: 'border-blue-100 bg-blue-50 text-blue-700' }
      : detected
        ? { icon: <AlertTriangle size={16} />, text: damage.detectionCount === null ? '偵測到疑似損傷' : `偵測到 ${damage.detectionCount} 處疑似損傷`, className: 'border-amber-200 bg-amber-50 text-[#8a5b00]' }
        : noDamage
          ? { icon: <CheckCircle2 size={16} />, text: '未偵測到損傷', className: 'border-emerald-100 bg-emerald-50 text-irent-green' }
          : { icon: <CircleMinus size={16} />, text: '尚未分析', className: 'border-slate-200 bg-slate-50 text-slate-500' };

  const statusText = failed ? '失敗' : processing ? '分析中' : succeeded ? '成功' : '尚未分析';
  const countText = damage.detectionCount === null ? '—' : `${damage.detectionCount} 處`;
  const rawJson = (() => {
    try { return JSON.stringify(photo.aiResult ?? {}, null, 2); }
    catch { return '無法顯示原始 AI 資料'; }
  })();

  return (
    <section className="mt-1.5 border-t border-slate-100 pt-2.5" aria-label="AI 車損分析">
      <h4 className="m-0 mb-2 text-[11px] font-black text-irent-ink">AI 車損分析</h4>
      <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-bold ${summary.className}`}>
        <span className="shrink-0">{summary.icon}</span><span>{summary.text}</span>
      </div>
      <dl className="my-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-irent-muted">偵測損傷</dt><dd className="m-0 font-bold text-irent-ink">{countText}</dd>
        <dt className="text-irent-muted">分析狀態</dt><dd className="m-0 font-bold text-irent-ink">{statusText}</dd>
        <dt className="text-irent-muted">分析時間</dt><dd className="m-0 font-bold text-irent-ink text-right">{formatLocalTime(damage.checkedAt)}</dd>
      </dl>

      <details className="group rounded-lg border border-slate-200 bg-white text-[10px] text-irent-muted">
        <summary className="cursor-pointer select-none px-2.5 py-2 font-bold text-irent-muted hover:text-irent-red">查看技術詳情</summary>
        <div className="border-t border-slate-100 p-2.5">
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-all">
            <dt>photoId</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(photo.photoId)}</dd>
            <dt>schema_version</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(damage.schemaVersion)}</dd>
            <dt>blur score</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(photo.blurScore)}</dd>
            <dt>blur threshold</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(photo.blurThreshold)}</dd>
            <dt>confidence</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(damage.confidence)}</dd>
            <dt>detection_count</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(damage.detectionCount)}</dd>
            <dt>inference_status</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(damage.inferenceStatus)}</dd>
            <dt>failure_reason</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(damage.failureReason)}</dd>
            <dt>checked_at</dt><dd className="m-0 font-mono text-irent-ink">{technicalValue(damage.checkedAt)}</dd>
          </dl>
          <p className="mb-1 mt-2 font-bold">detections</p>
          <pre className="m-0 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-2 font-mono text-[9px] leading-relaxed text-slate-100">{JSON.stringify(damage.detections, null, 2)}</pre>
          <p className="mb-1 mt-2 font-bold">raw AI JSON</p>
          <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-2 font-mono text-[9px] leading-relaxed text-slate-100">{rawJson}</pre>
        </div>
      </details>
    </section>
  );
};

const Submissions: React.FC = () => {
  const { state } = useApp();
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const submissions = state?.photoSubmissions || [];

  const getPhotosForSubmission = (submissionId: string) => {
    return (state?.uploadedPhotos || []).filter(p => p.submissionId === submissionId);
  };

  return (
    <div className="bg-white border border-irent-line rounded-2xl shadow-premium p-4 sm:p-5 flex flex-col gap-4 min-w-0">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pb-3 border-b border-irent-line">
        <h2 className="text-lg font-black text-irent-ink">照片提交紀錄</h2>
        <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">SQLite + AI Result</span>
      </div>

      <div className="flex flex-col gap-3.5 max-h-[680px] overflow-y-auto divide-y divide-irent-line">
        {submissions.length > 0 ? (
          submissions.map(item => {
            const photos = getPhotosForSubmission(item.submissionId);
            const statusClass = item.overallStatus === 'ok' ? 'bg-[#e9f4ea] text-irent-green' : 'bg-[#fff4d6] text-[#8a5b00]';

            return (
              <article key={item.submissionId} className="pt-3.5 first:pt-0 flex flex-col gap-3.5">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-4">
                  <div className="min-w-0">
                    <strong className="text-irent-ink font-bold block text-base">{item.submissionId}</strong>
                    <p className="text-irent-muted text-xs my-0.5">{item.rentalId} · {item.plate} · {item.phase === 'pickup' ? '取車檢查' : '還車檢查'}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${statusClass}`}>
                    {item.overallStatus === 'ok' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {item.overallStatus}
                  </span>
                </div>

                <p className="text-irent-ink text-sm leading-relaxed m-0">{item.aiSummary}</p>
                {item.phase === 'return' && item.returnLocation && <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-xs text-irent-muted"><strong className="text-irent-ink">還車停車位置</strong><p className="m-0 mt-1">{[item.returnLocation.address, item.returnLocation.parkingFacility, item.returnLocation.floor, item.returnLocation.zone, item.returnLocation.pillar, item.returnLocation.parkingSlot].filter(Boolean).join(' / ') || '未提供'}</p>{item.returnLocation.locationNote && <p className="m-0 mt-1">補充：{item.returnLocation.locationNote}</p>}</div>}

                {/* Photo grid of this submission */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {photos.map(photo => {
                    const blurChecked = photo.blurScore !== null || Boolean(photo.blurCheckedAt);
                    return (
                      <div key={photo.photoId} className="border border-irent-line rounded-2xl p-3 bg-[#fafafa] flex flex-col gap-1.5 text-xs min-w-0">
                      {photo.filePath && (
                        <div 
                          onClick={() => setPreviewImage(`/${photo.filePath}`)}
                          className="relative group w-full h-28 rounded-xl overflow-hidden border border-irent-line bg-slate-100 mb-2 cursor-pointer hover:border-irent-red transition-all"
                          title="點擊放大預覽"
                        >
                          <img 
                            src={`/${photo.filePath}`} 
                            alt={photo.slot} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-all duration-200" 
                          />
                          <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all text-white">
                            <Eye size={16} />
                          </div>
                        </div>
                      )}
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 border-b border-slate-100 pb-1.5 mb-1.5">
                        <strong className="text-irent-ink font-black">{photo.slot}</strong>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                          photo.qualityPassed ? 'bg-[#e9f4ea] text-irent-green' : 'bg-[#fff4d6] text-[#8a5b00]'
                        }`}>
                          {photo.qualityPassed ? '品質通過' : '需檢查'}
                        </span>
                      </div>
                      <section className="flex flex-col gap-1.5 text-[11px]" aria-label="拍攝品質">
                        <h4 className="m-0 mb-0.5 font-black text-irent-ink">拍攝品質</h4>
                        <QualityLine passed={blurChecked ? !photo.isBlur : null} success="清晰度正常" warning="照片可能模糊" pending="清晰度尚未檢查" />
                        {isPlateApplicable(photo.slot) && <QualityLine passed={booleanValue(photo.plateVisible)} success="車牌清楚可辨" warning="車牌無法辨識" />}
                        <QualityLine passed={booleanValue(photo.angleValid)} success="拍攝角度正常" warning="拍攝角度不符合要求" />
                        <QualityLine passed={booleanValue(photo.distanceValid)} success="拍攝距離正常" warning="拍攝距離不符合要求" />
                      </section>
                      <DamageResult photo={photo} />
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })
        ) : (
          <div className="text-center py-20 text-irent-muted flex flex-col items-center justify-center gap-2">
            <HelpCircle size={40} className="text-irent-line" />
            目前尚無租客照片提交紀錄。
          </div>
        )}
      </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-3xl w-full max-h-[85vh] bg-white rounded-3xl overflow-hidden border border-irent-line shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/60 text-white hover:bg-irent-red transition-all flex items-center justify-center"
            >
              <X size={18} />
            </button>
            <div className="p-3 sm:p-4 flex-1 flex items-center justify-center bg-slate-950 overflow-hidden min-h-[220px] sm:min-h-[300px]">
              <img
                src={previewImage}
                alt="Uploaded Preview"
                className="max-w-full max-h-[70vh] object-contain rounded-2xl"
              />
            </div>
            <div className="p-4 bg-white border-t border-irent-line text-center text-xs text-irent-muted font-bold">
              照片預覽
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Submissions;
