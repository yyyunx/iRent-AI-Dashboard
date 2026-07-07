import React from 'react';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';

const Submissions: React.FC = () => {
  const { state } = useApp();

  const submissions = state?.photoSubmissions || [];

  const getPhotosForSubmission = (submissionId: string) => {
    return (state?.uploadedPhotos || []).filter(p => p.submissionId === submissionId);
  };

  return (
    <div className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-4">
      <div className="flex justify-between items-center pb-3 border-b border-irent-line">
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
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <strong className="text-irent-ink font-bold block text-base">{item.submissionId}</strong>
                    <p className="text-irent-muted text-xs my-0.5">{item.rentalId} · {item.plate} · {item.phase === 'pickup' ? '取車檢查' : '還車檢查'}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${statusClass}`}>
                    {item.overallStatus === 'ok' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {item.overallStatus}
                  </span>
                </div>

                <p className="text-irent-ink text-sm leading-relaxed m-0">{item.aiSummary}</p>

                {/* Photo grid of this submission */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {photos.map(photo => (
                    <div key={photo.photoId} className="border border-irent-line rounded-2xl p-3 bg-[#fafafa] flex flex-col gap-1.5 text-xs">
                      <div className="flex justify-between items-center border-b border-slate-100 pb-1.5 mb-1.5">
                        <strong className="text-irent-ink font-black">{photo.slot}</strong>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                          photo.qualityPassed ? 'bg-[#e9f4ea] text-irent-green' : 'bg-[#fff4d6] text-[#8a5b00]'
                        }`}>
                          Quality: {photo.qualityPassed ? 'pass' : 'check'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 text-[11px] text-irent-muted">
                        <span>Blur score: {photo.blurScore ?? '-'}</span>
                        <span>Plate Visible: {photo.plateVisible ? 'yes' : 'no'}</span>
                        <span>Angle Valid: {photo.angleValid ? 'yes' : 'no'}</span>
                        <span>Distance Valid: {photo.distanceValid ? 'yes' : 'no'}</span>
                        <div className="mt-1.5 p-2 bg-white rounded-xl border border-slate-100 text-[10px] font-mono whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto">
                          AI: {JSON.stringify(photo.aiResult)}
                        </div>
                      </div>
                    </div>
                  ))}
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
    </div>
  );
};

export default Submissions;
