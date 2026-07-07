import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { ArrowLeft, CheckCircle2, AlertTriangle, HelpCircle, Image, Upload } from 'lucide-react';

const PHOTO_SLOTS = [
  { key: 'front', label: '車頭' },
  { key: 'right_side', label: '右側' },
  { key: 'rear', label: '車尾' },
  { key: 'left_side', label: '左側' },
  { key: 'front_interior', label: '前座內裝' },
  { key: 'backseat_interior', label: '後座內裝' }
];

interface CheckedPhoto {
  photoId: string;
  filename: string;
  quality: {
    passed: boolean;
    blurScore: number;
    isBlur: boolean;
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
  const { apiPost, showToast } = useApp();

  const [phase, setPhase] = useState<'pickup' | 'return'>('pickup');
  const [rentalId, setRentalId] = useState('R-20260704-001');
  const [plate, setPlate] = useState('ABC-1234');
  const [station, setStation] = useState('台北 101 站');
  const [parkingLocation, setParkingLocation] = useState('B3 100');
  const [note, setNote] = useState('');
  const [checkedPhotos, setCheckedPhotos] = useState<Record<string, CheckedPhoto>>({});
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<LastSubmission | null>(null);

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
    try {
      const fileData = file ? await readPhoto(file) : null;
      const payload = getPayload(slot, fileData);
      
      const response = await apiPost('/api/photos/quality-check', payload);
      
      setCheckedPhotos(prev => ({
        ...prev,
        [slot]: {
          photoId: response.photoId,
          filename: payload.filename,
          quality: response.quality
        }
      }));

      showToast("照片品質檢查完成", `${slot}: ${response.quality.message}`);
    } catch (error: any) {
      showToast("品質檢查失敗", error.message);
    }
  };

  const seedDemoPhotos = (type: 'clear' | 'issue') => {
    const demoNote = type === 'issue' ? 'scratch dirty' : 'normal clean';
    setNote(demoNote);
    
    const newChecked: Record<string, CheckedPhoto> = {};
    PHOTO_SLOTS.forEach(slot => {
      const filename = type === 'issue' && (slot.key === 'right_side' || slot.key === 'backseat_interior')
        ? `${slot.key}-${slot.key === 'right_side' ? 'scratch' : 'dirty'}.jpg`
        : `${slot.key}-normal.jpg`;
        
      newChecked[slot.key] = {
        photoId: '',
        filename,
        quality: {
          passed: true,
          blurScore: 135.2,
          isBlur: false,
          plateVisible: true,
          angleValid: true,
          distanceValid: true,
          message: '照片品質通過'
        }
      };
    });
    
    setCheckedPhotos(newChecked);
    setLastSubmission({
      submissionId: '尚未提交',
      overallStatus: type === 'issue' ? 'warning' : 'ok',
      createdIncidents: [],
      title: 'Demo 照片已填入',
      body: type === 'issue' ? '本次送出會模擬異常並建立營運端 Incident。' : '本次送出會模擬正常照片。'
    });
  };

  const submitPhotoFlow = async () => {
    if (submitting) return;
    setSubmitting(true);
    
    const photos = PHOTO_SLOTS.map(slot => {
      const checked = checkedPhotos[slot.key];
      return {
        slot: slot.key,
        photoId: checked?.photoId || '',
        filename: checked?.filename || `${slot.key}${note ? '-' + note : ''}.jpg`,
        note,
        qualityPassed: checked?.quality?.passed ?? true
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
    <div className="min-h-screen bg-irent-bg pt-2">
      <header className="mx-auto mt-7 w-[min(1120px,calc(100%-32px))] border border-irent-line rounded-[18px] bg-white shadow-premium p-[18px_22px] flex items-center justify-between gap-4">
        <div>
          <strong className="text-irent-red text-xl font-bold">iRent 使用者拍照檢查</strong>
          <p className="text-irent-muted text-xs m-0">只顯示取車檢查 / 還車檢查與本次提交結果。</p>
        </div>
        <button 
          onClick={() => navigate('/')}
          className="min-h-[38px] px-3 border border-irent-line rounded-xl text-irent-muted flex items-center gap-1.5 hover:bg-irent-soft-red hover:text-irent-red transition-all duration-200"
        >
          <ArrowLeft size={16} />
          切換身分
        </button>
      </header>

      <main className="w-[min(1120px,calc(100%-32px))] mx-auto mt-5 mb-10 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-[22px] items-start">
        {/* Upload Panel */}
        <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-4">
          <div className="flex justify-between items-center pb-3 border-b border-irent-line">
            <h2 className="text-lg font-black text-irent-ink">取車 / 還車檢查</h2>
            <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">Customer Photo Flow</span>
          </div>

          {/* Segmented Phase */}
          <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-irent-bg">
            <button
              onClick={() => { setPhase('pickup'); setCheckedPhotos({}); }}
              className={`border-0 rounded-xl min-h-[42px] font-extrabold text-sm transition-all duration-200 ${phase === 'pickup' ? 'bg-irent-red text-white shadow-lg' : 'text-irent-muted hover:text-irent-red'}`}
            >
              取車檢查
            </button>
            <button
              onClick={() => { setPhase('return'); setCheckedPhotos({}); }}
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
              placeholder="可輸入 scratch / dent / dirty / blur 來測試 mock AI 結果。"
              className="w-full min-h-[80px] border border-irent-line rounded-2xl p-[10px_12px] text-sm resize-y focus:outline-none focus:border-irent-red focus:ring-3 focus:ring-red-100"
            />
          </div>

          {/* Photo Slot Rows */}
          <div className="grid gap-2.5">
            {PHOTO_SLOTS.map(slot => {
              const checked = checkedPhotos[slot.key];
              const chipClass = checked 
                ? (checked.quality.passed ? 'bg-[#e9f4ea] text-irent-green' : 'bg-[#fff4d6] text-[#8a5b00]') 
                : 'bg-irent-bg text-irent-muted';
              const chipText = checked 
                ? `${checked.quality.passed ? '通過' : '重拍'} · ${checked.quality.blurScore}` 
                : '待檢查';

              return (
                <div key={slot.key} className="grid grid-cols-1 md:grid-cols-[110px_1fr_auto_116px] gap-2.5 items-center p-3 border border-irent-line rounded-2xl bg-white shadow-sm">
                  <strong className="text-[#222222] text-sm md:text-base">{slot.label}</strong>
                  
                  <div className="relative overflow-hidden w-full">
                    <input 
                      type="file" 
                      id={`customer-file-${slot.key}`}
                      accept="image/*"
                      onChange={e => handleQualityCheck(slot.key, e)}
                      className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-irent-soft-red file:text-irent-red hover:file:bg-irent-soft-red-strong cursor-pointer"
                    />
                  </div>

                  <span className={`inline-flex items-center justify-center min-h-[32px] rounded-full px-3 text-[11px] font-black ${chipClass}`}>
                    {chipText}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-2">
            <button
              onClick={() => seedDemoPhotos('clear')}
              className="w-full min-h-[44px] rounded-2xl border border-irent-red text-irent-red bg-white font-extrabold text-sm hover:shadow-hover hover:-translate-y-0.5 transition-all"
            >
              Demo 正常照片
            </button>
            <button
              onClick={() => seedDemoPhotos('issue')}
              className="w-full min-h-[44px] rounded-2xl border border-irent-red text-irent-red bg-white font-extrabold text-sm hover:shadow-hover hover:-translate-y-0.5 transition-all"
            >
              Demo 異常照片
            </button>
            <button
              onClick={submitPhotoFlow}
              disabled={submitting}
              className="w-full min-h-[44px] rounded-2xl border border-irent-red bg-irent-red text-white font-extrabold text-sm hover:shadow-hover hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {submitting ? '送出中...' : '完成送出'}
            </button>
          </div>
        </section>

        {/* Results Panel */}
        <section className="bg-white border border-irent-line rounded-2xl shadow-premium min-h-[280px] p-5 flex flex-col gap-4">
          <div className="flex justify-between items-center pb-3 border-b border-irent-line">
            <h2 className="text-lg font-black text-irent-ink">本次提交結果</h2>
            <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">Result Summary</span>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            {lastSubmission ? (
              <article className="border border-irent-line rounded-2xl p-4 bg-white flex flex-col gap-3">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <strong className="text-irent-ink font-bold block text-base">{lastSubmission.title}</strong>
                    <p className="text-irent-muted text-[11px] m-0">ID: {lastSubmission.submissionId}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${
                    lastSubmission.overallStatus === 'ok' ? 'bg-[#e9f4ea] text-irent-green' : 'bg-[#fff4d6] text-[#8a5b00]'
                  }`}>
                    {lastSubmission.overallStatus === 'ok' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {lastSubmission.overallStatus}
                  </span>
                </div>
                <p className="text-irent-ink text-sm leading-relaxed m-0">{lastSubmission.body}</p>
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
    </div>
  );
};

export default CustomerFlow;
