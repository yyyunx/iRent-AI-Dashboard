import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { ArrowLeft, CheckCircle2, AlertTriangle, HelpCircle, Image, Settings, Eye, X } from 'lucide-react';
import { checkBlurScore, FRONTEND_BLUR_THRESHOLD } from '../utils/blurDetection';

const PHOTO_SLOTS = [
  { key: 'front', label: '車頭' },
  { key: 'right_side', label: '右側' },
  { key: 'rear', label: '車尾' },
  { key: 'left_side', label: '左側' },
  { key: 'front_interior', label: '前座內裝' },
  { key: 'backseat_interior', label: '後座內裝' }
];

interface CheckedPhoto {
  status: 'idle' | 'checking' | 'passed' | 'failed' | 'error';
  photoId?: string;
  filename?: string;
  previewUrl?: string;
  feSharpness?: number;
  feWallTime?: number;
  precheck?: { score: number; threshold: number; passed: boolean };
  errorMessage?: string;
  quality?: {
    passed: boolean;
    blur: { score: number; threshold: number; passed: boolean };
    plateVisible: boolean;
    angleValid: boolean;
    distanceValid: boolean;
    message: string;
  };
}

interface LastSubmission {
  submissionId: string;
  overallStatus: string;
  createdIncidents: string[];
  body: string;
  title: string;
}

const CustomerFlow: React.FC = () => {
  const navigate = useNavigate();
  const { apiPost, showToast, developerMode, setDeveloperMode } = useApp();

  const [phase, setPhase] = useState<'pickup' | 'return'>('pickup');
  const [rentalId, setRentalId] = useState('R-20260704-001');
  const [plate, setPlate] = useState('ABC-1234');
  const [station, setStation] = useState('台北 101 站');
  const [parkingLocation, setParkingLocation] = useState('B3 100');
  const [note, setNote] = useState('');
  const [checkedPhotos, setCheckedPhotos] = useState<Record<string, CheckedPhoto>>({});
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<LastSubmission | null>(null);
  const qualityRequestIds = useRef<Record<string, number>>({});

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // File readers
  const readPhoto = (file: File): Promise<{ name: string; data: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, data: reader.result as string });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const getPayload = (slot: string, fileData: { name: string; data: string } | null) => {
    return {
      rentalId: rentalId.trim(),
      plate: plate.trim(),
      phase,
      station: station.trim(),
      parkingLocation: parkingLocation.trim(),
      slot,
      filename: fileData?.name || `${slot}${note ? '-' + note : ''}.jpg`,
      imageData: fileData?.data || 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      note: note.trim()
    };
  };

  const handleQualityCheck = async (slot: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const requestId = (qualityRequestIds.current[slot] || 0) + 1;
    qualityRequestIds.current[slot] = requestId;
    const isCurrent = () => qualityRequestIds.current[slot] === requestId;
    // Reset as soon as a new file is selected so no previous pass result can enable submission.
    setCheckedPhotos(prev => ({ ...prev, [slot]: { status: 'checking', filename: file.name } }));

    try {
      const fileData = await readPhoto(file);
      if (!isCurrent()) return;
      setCheckedPhotos(prev => ({
        ...prev,
        [slot]: { status: 'checking', filename: fileData.name, previewUrl: fileData.data }
      }));
      
      // Fast UX filter only. The server always recalculates from uploaded image bytes.
      const blurMetrics = await checkBlurScore(fileData.data);
      if (!isCurrent()) return;
      const precheck = { score: blurMetrics.variance, threshold: FRONTEND_BLUR_THRESHOLD, passed: !blurMetrics.isBlur };
      if (blurMetrics.isBlur) {
        setCheckedPhotos(prev => ({
          ...prev,
          [slot]: {
            status: 'failed', filename: fileData.name, previewUrl: fileData.data,
            feSharpness: blurMetrics.variance, feWallTime: blurMetrics.wallTime, precheck,
            errorMessage: '照片過於模糊，請重新拍攝後再上傳。'
          }
        }));
        return;
      }
      
      const basePayload = getPayload(slot, fileData);
      const response = await apiPost('/api/photos/quality-check', basePayload);
      if (!isCurrent()) return;
      
      setCheckedPhotos(prev => ({
        ...prev,
        [slot]: {
          status: 'passed',
          photoId: response.photoId,
          filename: basePayload.filename,
          previewUrl: fileData.data,
          feSharpness: blurMetrics.variance,
          feWallTime: blurMetrics.wallTime,
          precheck,
          quality: response.quality
        }
      }));

      showToast("照片品質檢查完成", `${slot}: ${response.quality.message}`);
    } catch (error: any) {
      if (!isCurrent()) return;
      const quality = error.payload?.quality;
      const isBlurFailure = error.code === 'IMAGE_TOO_BLURRY';
      setCheckedPhotos(prev => ({
        ...prev,
        [slot]: {
          status: isBlurFailure ? 'failed' : 'error',
          filename: file.name,
          previewUrl: prev[slot]?.previewUrl,
          feSharpness: prev[slot]?.feSharpness,
          feWallTime: prev[slot]?.feWallTime,
          precheck: prev[slot]?.precheck,
          quality,
          errorMessage: isBlurFailure ? '照片過於模糊，請重新拍攝後再上傳。' : '目前無法完成照片品質檢查，請重新嘗試。'
        }
      }));
      showToast(isBlurFailure ? '照片模糊' : '品質檢查失敗', isBlurFailure ? '照片過於模糊，請重新拍攝後再上傳。' : '目前無法完成照片品質檢查，請重新嘗試。');
    }
  };

  const resetPhotos = () => {
    PHOTO_SLOTS.forEach(slot => {
      qualityRequestIds.current[slot.key] = (qualityRequestIds.current[slot.key] || 0) + 1;
    });
    setCheckedPhotos({});
  };

  const submitPhotoFlow = async () => {
    if (submitting) return;
    const allPhotosPassed = PHOTO_SLOTS.every(slot => {
      const checked = checkedPhotos[slot.key];
      return checked?.status === 'passed' && Boolean(checked.photoId) && checked.quality?.blur.passed;
    });
    if (!allPhotosPassed) {
      showToast('尚未完成照片檢查', '所有必填照片都必須先通過後端品質檢查。');
      return;
    }
    setSubmitting(true);
    
    const photos = PHOTO_SLOTS.map(slot => {
      const checked = checkedPhotos[slot.key];
      return {
        slot: slot.key,
        photoId: checked?.photoId || '',
        filename: checked?.filename || `${slot.key}${note ? '-' + note : ''}.jpg`,
        note,
        qualityPassed: checked?.quality?.passed ?? false
      };
    });

    const payload = {
      rentalId: rentalId.trim(),
      plate: plate.trim(),
      phase,
      station: station.trim(),
      parkingLocation: parkingLocation.trim(),
      photos
    };

    try {
      const response = await apiPost('/api/photo-submissions', payload);
      setLastSubmission({
        submissionId: response.submissionId,
        overallStatus: response.overallStatus,
        createdIncidents: response.createdIncidents,
        title: response.createdIncidents.length ? '已送出，需營運端確認' : '已送出，未偵測異常',
        body: `提交編號 ${response.submissionId}，AI 狀態 ${response.overallStatus}。`
      });
      showToast("提交成功", `已完成還/取車相片提交，ID: ${response.submissionId}`);
    } catch (error: any) {
      showToast("送出失敗", error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-irent-bg pt-2 overflow-x-hidden">
      <header className="mx-auto mt-4 sm:mt-7 w-[min(1120px,calc(100%-24px))] sm:w-[min(1120px,calc(100%-32px))] border border-irent-line rounded-[18px] bg-white shadow-premium p-4 sm:p-[18px_22px] flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <strong className="text-irent-red text-lg sm:text-xl font-bold break-anywhere">iRent 使用者拍照檢查</strong>
          <p className="text-irent-muted text-xs m-0 break-anywhere">只顯示取車檢查 / 還車檢查與本次提交結果。</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button 
            onClick={() => setShowSettingsModal(true)}
            className="min-h-[38px] w-[38px] flex items-center justify-center border border-irent-line rounded-xl text-irent-muted hover:bg-irent-soft-red hover:text-irent-red transition-all duration-200"
            title="系統設定"
          >
            <Settings size={16} />
          </button>
          <button 
            onClick={() => navigate('/')}
            className="min-h-[38px] flex-1 sm:flex-initial px-3 border border-irent-line rounded-xl text-irent-muted flex items-center justify-center gap-1.5 hover:bg-irent-soft-red hover:text-irent-red transition-all duration-200"
          >
            <ArrowLeft size={16} />
            切換身分
          </button>
        </div>
      </header>

      <main className="w-[min(1120px,calc(100%-24px))] sm:w-[min(1120px,calc(100%-32px))] mx-auto mt-5 mb-10 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4 sm:gap-[22px] items-start min-w-0">
        {/* Upload Panel */}
        <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-4 sm:p-5 flex flex-col gap-4 min-w-0">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center pb-3 border-b border-irent-line gap-2">
            <h2 className="text-lg font-black text-irent-ink">取車 / 還車檢查</h2>
            <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">Customer Photo Flow</span>
          </div>

          {/* Segmented Phase */}
          <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-irent-bg">
            <button
              onClick={() => { setPhase('pickup'); resetPhotos(); }}
              className={`border-0 rounded-xl min-h-[42px] font-extrabold text-sm transition-all duration-200 ${phase === 'pickup' ? 'bg-irent-red text-white shadow-lg' : 'text-irent-muted hover:text-irent-red'}`}
            >
              取車檢查
            </button>
            <button
              onClick={() => { setPhase('return'); resetPhotos(); }}
              className={`border-0 rounded-xl min-h-[42px] font-extrabold text-sm transition-all duration-200 ${phase === 'return' ? 'bg-irent-red text-white shadow-lg' : 'text-irent-muted hover:text-irent-red'}`}
            >
              還車檢查
            </button>
          </div>

          {/* Metadata Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-extrabold text-irent-muted">Rental ID</label>
              <input 
                value={rentalId} 
                onChange={e => setRentalId(e.target.value)}
                className="w-full min-h-[42px] border border-irent-line rounded-2xl px-3 text-sm focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-extrabold text-irent-muted">Plate</label>
              <input 
                value={plate} 
                onChange={e => setPlate(e.target.value)}
                className="w-full min-h-[42px] border border-irent-line rounded-2xl px-3 text-sm focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-extrabold text-irent-muted">Station / Location</label>
              <input 
                value={station} 
                onChange={e => setStation(e.target.value)}
                className="w-full min-h-[42px] border border-irent-line rounded-2xl px-3 text-sm focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-extrabold text-irent-muted">Parking Location</label>
              <input 
                value={parkingLocation} 
                onChange={e => setParkingLocation(e.target.value)}
                className="w-full min-h-[42px] border border-irent-line rounded-2xl px-3 text-sm focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-extrabold text-irent-muted">備註</label>
            <textarea 
              value={note} 
              onChange={e => setNote(e.target.value)}
              placeholder="可輸入 scratch / dent / dirty 來測試 mock AI 結果。"
              className="w-full min-h-[80px] border border-irent-line rounded-2xl p-[10px_12px] text-sm resize-y focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
            />
          </div>

          {/* Photo Slot Rows */}
          <div className="grid gap-2.5">
            {PHOTO_SLOTS.map(slot => {
              const checked = checkedPhotos[slot.key];
              const chipClass = checked?.status === 'passed' ? 'bg-[#e9f4ea] text-irent-green'
                : checked?.status === 'failed' ? 'bg-[#fff3f3] text-irent-red'
                : checked?.status === 'error' ? 'bg-[#fff4d6] text-[#8a5b00]'
                : checked?.status === 'checking' ? 'bg-blue-50 text-blue-700'
                : 'bg-irent-bg text-irent-muted';
              const chipText = checked?.status === 'passed' ? '✓ 通過'
                : checked?.status === 'failed' ? '✕ 照片模糊，請重新拍攝'
                : checked?.status === 'error' ? '⚠ 無法完成檢查，請重試'
                : checked?.status === 'checking' ? '○ 檢測中...'
                : '待檢查';

              return (
                <div key={slot.key} className="flex flex-col gap-2.5 p-3 sm:p-3.5 border border-irent-line rounded-2xl bg-white shadow-sm min-w-0">
                  <div className="flex flex-col sm:flex-row sm:flex-wrap md:flex-nowrap sm:items-center gap-3.5 justify-between min-w-0">
                    {/* Preview Thumbnail */}
                    <div className="flex-shrink-0">
                      {checked?.previewUrl ? (
                        <div 
                          onClick={() => setPreviewImage(checked.previewUrl!)}
                          className="relative group w-14 h-11 rounded-xl overflow-hidden border border-irent-line cursor-pointer hover:border-irent-red transition-all shadow-sm"
                          title="點擊放大預覽"
                        >
                          <img 
                            src={checked.previewUrl} 
                            alt={slot.label} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-all duration-200" 
                          />
                          <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all text-white">
                            <Eye size={12} />
                          </div>
                        </div>
                      ) : (
                        <div className="w-14 h-11 bg-irent-bg rounded-xl border border-irent-line flex items-center justify-center text-irent-muted">
                          <Image size={16} />
                        </div>
                      )}
                    </div>

                    {/* Label and Input */}
                    <div className="w-full sm:flex-1 min-w-0 flex flex-col gap-1">
                      <strong className="text-[#222222] text-sm md:text-base break-anywhere">{slot.label}</strong>
                      <input 
                        type="file" 
                        id={`customer-file-${slot.key}`}
                        accept="image/*"
                        capture="environment"
                        onClick={event => { event.currentTarget.value = ''; }}
                        onChange={e => handleQualityCheck(slot.key, e)}
                        className="w-full text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-irent-soft-red file:text-irent-red hover:file:bg-irent-soft-red-strong cursor-pointer"
                      />
                    </div>

                    {/* Status Badge */}
                    <div className="w-full sm:w-auto flex-shrink-0 flex items-center">
                      <span className={`inline-flex items-center justify-center min-h-[32px] w-full sm:w-auto rounded-full px-3 text-[11px] font-black break-anywhere ${chipClass}`}>
                        {chipText}
                      </span>
                    </div>
                  </div>

                  {checked?.errorMessage && <p className={`m-0 text-xs font-bold ${checked.status === 'failed' ? 'text-irent-red' : 'text-[#8a5b00]'}`}>{checked.errorMessage}</p>}

                  {/* Inline developer stats when Developer Mode is active */}
                  {developerMode && checked && (checked.feSharpness !== undefined || checked.feWallTime !== undefined) && (
                    <div className="mt-1 px-3 py-2 border border-dashed border-irent-line rounded-xl bg-[#fafafa] flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-[10px] font-mono text-irent-muted break-anywhere">
                      <span className="flex items-center gap-1">
                        <strong className="text-irent-ink">LoG Sharpness:</strong>
                        <span className={checked.precheck?.passed === false ? 'text-irent-red font-bold' : 'text-irent-green font-bold'}>
                          {checked.feSharpness ?? '-'}
                        </span>
                        <span className="text-[9px] opacity-75">
                          (threshold: {checked.precheck?.threshold ?? FRONTEND_BLUR_THRESHOLD})
                        </span>
                      </span>
                      <span className="hidden sm:block w-px h-3 bg-irent-line" />
                      <span>
                        <strong className="text-irent-ink">Wall Time:</strong> {checked.feWallTime !== undefined ? `${checked.feWallTime} ms` : '-'}
                      </span>
                      {checked.quality?.blur && <><span className="hidden sm:block w-px h-3 bg-irent-line" /><span><strong className="text-irent-ink">Server Laplacian:</strong> {checked.quality.blur.score} / {checked.quality.blur.threshold}</span></>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 gap-2.5 mt-2">
            <button
              onClick={submitPhotoFlow}
              disabled={submitting || !PHOTO_SLOTS.every(slot => {
                const checked = checkedPhotos[slot.key];
                return checked?.status === 'passed' && Boolean(checked.photoId) && checked.quality?.blur.passed;
              })}
              className="w-full min-h-[44px] rounded-2xl border border-irent-red bg-irent-red text-white font-extrabold text-sm hover:shadow-hover hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {submitting ? '送出中...' : '完成送出'}
            </button>
          </div>
        </section>

        {/* Results Panel */}
        <section className="bg-white border border-irent-line rounded-2xl shadow-premium min-h-[280px] p-4 sm:p-5 flex flex-col gap-4 min-w-0">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center pb-3 border-b border-irent-line gap-2">
            <h2 className="text-lg font-black text-irent-ink">本次提交結果</h2>
            <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">Result Summary</span>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            {lastSubmission ? (
              <article className="border border-irent-line rounded-2xl p-4 bg-white flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                  <div className="min-w-0">
                    <strong className="text-irent-ink font-bold block text-base break-anywhere">{lastSubmission.title}</strong>
                    <p className="text-irent-muted text-[11px] m-0 break-all">ID: {lastSubmission.submissionId}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${
                    lastSubmission.overallStatus === 'ok' ? 'bg-[#e9f4ea] text-irent-green' : 'bg-[#fff4d6] text-[#8a5b00]'
                  }`}>
                    {lastSubmission.overallStatus === 'ok' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {lastSubmission.overallStatus}
                  </span>
                </div>
                <p className="text-irent-ink text-sm leading-relaxed m-0 break-anywhere">{lastSubmission.body}</p>
                {lastSubmission.createdIncidents && lastSubmission.createdIncidents.length > 0 && (
                  <div className="mt-2 text-xs text-[#8f1d1d] bg-[#fff3f3] p-3 rounded-xl border border-[#fde5e5] leading-relaxed">
                    <strong>系統已建立異常紀錄，營運人員可於 Dashboard 查看。</strong>
                    <ul className="list-disc pl-4 mt-1">
                      {lastSubmission.createdIncidents.map(incId => (
                        <li key={incId}>{incId}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ) : (
              <div className="text-center py-10 flex flex-col items-center gap-2">
                <HelpCircle size={40} className="text-irent-line" />
                <p className="text-irent-muted text-sm m-0">完成送出後，這裡將顯示本次提交摘要。</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto border border-irent-line shadow-2xl p-4 sm:p-6 relative animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setShowSettingsModal(false)}
              className="absolute top-4 right-4 text-irent-muted hover:text-irent-red transition-all"
            >
              <X size={20} />
            </button>
            <h3 className="text-lg font-black text-irent-ink mb-4 flex items-center gap-2">
              <Settings size={20} className="text-irent-red animate-spin-slow" />
              拍照流程設定
            </h3>
            
            <div className="border-t border-irent-line pt-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <strong className="block text-sm text-irent-ink font-bold">開啟開發者模式</strong>
                  <span className="text-irent-muted text-[11px] block mt-0.5 leading-normal">
                    在下方欄位顯示前端 Laplacian of Gaussian 的變異數分數以及計算所花費的時間（Wall Time）。
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={developerMode}
                  onChange={(e) => {
                    setDeveloperMode(e.target.checked);
                    showToast(
                      e.target.checked ? "開啟開發者模式" : "關閉開發者模式",
                      e.target.checked ? "已啟用 LoG 變異數與推論耗時顯示。" : "已隱藏開發者偵錯資訊。"
                    );
                  }}
                  className="w-5 h-5 accent-irent-red cursor-pointer flex-shrink-0"
                />
              </div>
            </div>
          </div>
        </div>
      )}

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

export default CustomerFlow;
