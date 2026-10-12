import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { ArrowLeft, CheckCircle2, AlertTriangle, HelpCircle, Image, Settings, Eye, X, Camera, CameraOff } from 'lucide-react';
import { checkBlurScore, FRONTEND_BLUR_THRESHOLD } from '../utils/blurDetection';
import { useAuth } from '../context/AuthContext';
import Vehicle3DViewer from '../components/vehicle/Vehicle3DViewer';
import type { AiViewerPose } from '../components/vehicle/Vehicle3DViewer';
import { GUIDANCE_INTERVAL_MS, GUIDANCE_JPEG_QUALITY, GUIDANCE_MAX_FRAME_EDGE, canStartGuidanceRequest, isCurrentGuidanceResponse, isReliableGuidance, smoothViewerPose } from '../utils/continuousGuidance';

const PHOTO_SLOTS = [
  { key: 'front', label: '車頭' },
  { key: 'right_side', label: '右側' },
  { key: 'rear', label: '車尾' },
  { key: 'left_side', label: '左側' }
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
  guidance?: GuidanceResult;
  damage?: DamageResult;
}

interface DamageResult {
  damage_status: 'detected' | 'none' | 'unavailable';
  detection_count: number;
  confidence: number | null;
  detections: Array<{ label: 'Scratched' | 'Dented' | 'Broken'; confidence: number; bbox_xyxy: [number, number, number, number]; verification?: { is_damage: boolean; damage_type: string; confidence: number; reason: string } }>;
  vlm?: { status: 'success' | 'skipped_no_candidates' | 'disabled' | 'unavailable' | 'timeout' | 'failed'; model: string | null; failure_reason: string | null };
  inference_status: 'success' | 'failed';
  failure_reason: string | null;
}

interface LastSubmission {
  submissionId: string;
  overallStatus: string;
  createdIncidents: string[];
  body: string;
  title: string;
}

interface GuidanceResult {
  success: boolean;
  failure_reason: string | null;
  correspondence_count: number;
  inlier_count: number;
  inlier_ratio: number;
  reprojection_error: number | null;
  guidance_status: 'FULL' | 'DEGRADED' | 'UNAVAILABLE';
  solver_used: 'EPNP' | 'AP3P' | 'NONE';
  degradation_reason: string | null;
  view_sector: ViewSector | null;
  covered_sectors: ViewSector[];
  yaw?: number;
  pitch?: number;
  roll?: number;
  distance?: number;
  viewer_pose?: {
    camera_direction_from_target: [number, number, number];
    camera_up: [number, number, number];
  };
}

const VIEW_SECTORS = ['FRONT', 'FRONT_RIGHT', 'RIGHT', 'REAR_RIGHT', 'REAR', 'REAR_LEFT', 'LEFT', 'FRONT_LEFT'] as const;
type ViewSector = typeof VIEW_SECTORS[number];
const SECTOR_LABELS: Record<ViewSector, string> = {
  FRONT: '車頭', FRONT_RIGHT: '右前方', RIGHT: '右側', REAR_RIGHT: '右後方',
  REAR: '車尾', REAR_LEFT: '左後方', LEFT: '左側', FRONT_LEFT: '左前方'
};

interface ReturnLocationForm {
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  gpsCapturedAt?: string;
  address: string;
  station: string;
  parkingFacility: string;
  floor: string;
  zone: string;
  pillar: string;
  parkingSlot: string;
  locationNote: string;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';
const CUSTOMER_SUBMISSION_TOAST_SCOPE = 'customer-submission';

const CustomerFlow: React.FC = () => {
  const navigate = useNavigate();
  const { apiPost, showToast, clearToasts, developerMode, setDeveloperMode } = useApp();
  const auth = useAuth();

  const [phase, setPhase] = useState<'pickup' | 'return'>('pickup');
  const [rentalId, setRentalId] = useState('R-20260704-001');
  const [plate, setPlate] = useState('ABC-1234');
  const [station, setStation] = useState('台北 101 站');
  const [parkingLocation, setParkingLocation] = useState('B3 100');
  const [returnLocation, setReturnLocation] = useState<ReturnLocationForm>({
    address: '', station: '台北 101 站', parkingFacility: '', floor: '', zone: '', pillar: '', parkingSlot: '', locationNote: ''
  });
  const [gpsState, setGpsState] = useState<'idle' | 'capturing' | 'captured' | 'unavailable'>('idle');
  const [gpsMessage, setGpsMessage] = useState('');
  const [note, setNote] = useState('');
  const [checkedPhotos, setCheckedPhotos] = useState<Record<string, CheckedPhoto>>({});
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastSubmission, setLastSubmission] = useState<LastSubmission | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const qualityRequestIds = useRef<Record<string, number>>({});
  const qualityEpoch = useRef(0);
  const submitStateRef = useRef<SubmitState>('idle');
  const submitInFlightRef = useRef(false);
  const submissionRequestId = useRef(0);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<GuidanceResult | null>(null);
  const [guidanceStatus, setGuidanceStatus] = useState<'idle' | 'checking' | 'full' | 'degraded' | 'unavailable'>('idle');
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'streaming' | 'error'>('idle');
  const [cameraMessage, setCameraMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const guidanceTimerRef = useRef<number | null>(null);
  const guidanceAbortRef = useRef<AbortController | null>(null);
  const guidanceInFlightRef = useRef(false);
  const guidanceGenerationRef = useRef(0);
  const guidanceRequestIdRef = useRef(0);
  const acceptedRequestIdRef = useRef(0);
  const acceptedPoseRef = useRef<AiViewerPose>();
  const coverage = useMemo(() => {
    const coveredSet = new Set<ViewSector>();
    Object.values(checkedPhotos).forEach(photo => photo.guidance?.covered_sectors.forEach(sector => coveredSet.add(sector)));
    const covered = VIEW_SECTORS.filter(sector => coveredSet.has(sector));
    const missing = VIEW_SECTORS.filter(sector => !coveredSet.has(sector));
    return { covered, missing, percentage: covered.length / VIEW_SECTORS.length * 100, next: missing[0] || null };
  }, [checkedPhotos]);

  const setSubmissionState = (nextState: SubmitState) => {
    submitStateRef.current = nextState;
    setSubmitState(nextState);
  };

  const invalidateQualityRequests = () => {
    qualityEpoch.current += 1;
    PHOTO_SLOTS.forEach(slot => {
      qualityRequestIds.current[slot.key] = (qualityRequestIds.current[slot.key] || 0) + 1;
    });
  };

  const updateReturnLocation = (field: keyof ReturnLocationForm, value: string) => {
    setReturnLocation(previous => ({ ...previous, [field]: value }));
  };

  const captureGps = () => {
    if (!navigator.geolocation) {
      setGpsState('unavailable');
      setGpsMessage('此裝置不支援 GPS，請手動輸入停車位置。');
      return;
    }
    setGpsState('capturing');
    setGpsMessage('正在取得 GPS...');
    navigator.geolocation.getCurrentPosition(
      position => {
        setReturnLocation(previous => ({
          ...previous,
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          gpsAccuracy: Math.round(position.coords.accuracy),
          gpsCapturedAt: new Date(position.timestamp).toISOString()
        }));
        setGpsState('captured');
        setGpsMessage(`已取得目前位置，定位精度：約 ${Math.round(position.coords.accuracy)} 公尺`);
      },
      () => {
        setGpsState('unavailable');
        setGpsMessage('無法取得 GPS，請確認定位權限。你仍可手動輸入停車位置。');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  };

  const stopContinuousGuidance = useCallback(() => {
    guidanceGenerationRef.current += 1;
    guidanceAbortRef.current?.abort();
    guidanceAbortRef.current = null;
    guidanceInFlightRef.current = false;
    if (guidanceTimerRef.current !== null) window.clearInterval(guidanceTimerRef.current);
    guidanceTimerRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState('idle');
    setCameraMessage('');
  }, []);

  const switchPhase = (nextPhase: 'pickup' | 'return') => {
    stopContinuousGuidance();
    setPhase(nextPhase);
    resetPhotos();
    if (nextPhase === 'return') void captureGps();
  };

  useEffect(() => stopContinuousGuidance, [stopContinuousGuidance]);

  const captureGuidanceFrame = useCallback(async (generation: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !canStartGuidanceRequest(guidanceInFlightRef.current)) return;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return;
    const scale = Math.min(1, GUIDANCE_MAX_FRAME_EDGE / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/jpeg', GUIDANCE_JPEG_QUALITY);
    const requestId = ++guidanceRequestIdRef.current;
    const controller = new AbortController();
    guidanceAbortRef.current = controller;
    guidanceInFlightRef.current = true;
    if (!acceptedPoseRef.current) setGuidanceStatus('checking');
    try {
      const response = await apiPost('/api/photos/capture-guidance', { imageData }, { suppressErrorToast: true, signal: controller.signal, timeoutMs: 15_000 });
      if (!isCurrentGuidanceResponse(generation, guidanceGenerationRef.current, requestId, acceptedRequestIdRef.current, controller.signal.aborted)) return;
      const nextGuidance = response.guidance as GuidanceResult;
      if (!isReliableGuidance(nextGuidance) || !nextGuidance.viewer_pose || nextGuidance.guidance_status === 'UNAVAILABLE') {
        setCameraMessage('等待可靠視角');
        return;
      }
      const smoothed = smoothViewerPose(acceptedPoseRef.current, nextGuidance.viewer_pose);
      if (!smoothed) return;
      acceptedRequestIdRef.current = requestId;
      acceptedPoseRef.current = smoothed;
      setGuidance({ ...nextGuidance, viewer_pose: { ...nextGuidance.viewer_pose, ...smoothed } });
      setGuidanceStatus(nextGuidance.guidance_status === 'FULL' ? 'full' : 'degraded');
      setCameraMessage('已鎖定');
    } catch (error: any) {
      if (generation !== guidanceGenerationRef.current || error?.name === 'AbortError') return;
      if (!acceptedPoseRef.current) setGuidanceStatus('unavailable');
      setCameraMessage(error?.code === 'AI_SERVICE_TIMEOUT' || error?.status === 503 ? 'AI 服務暫時無法使用，仍可上傳照片' : '即時引導連線逾時，仍可上傳照片');
    } finally {
      if (generation === guidanceGenerationRef.current && requestId === guidanceRequestIdRef.current) {
        guidanceInFlightRef.current = false;
        guidanceAbortRef.current = null;
      }
    }
  }, [apiPost]);

  const startContinuousGuidance = async () => {
    if (!navigator.mediaDevices?.getUserMedia || cameraState === 'starting' || cameraState === 'streaming') return;
    stopContinuousGuidance();
    const generation = guidanceGenerationRef.current;
    setCameraState('starting');
    setCameraMessage('正在啟動相機…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (generation !== guidanceGenerationRef.current || phase !== 'return') {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('streaming');
      setCameraMessage(acceptedPoseRef.current ? '已鎖定' : '等待可靠視角');
      void captureGuidanceFrame(generation);
      guidanceTimerRef.current = window.setInterval(() => void captureGuidanceFrame(generation), GUIDANCE_INTERVAL_MS);
    } catch (error: any) {
      if (generation !== guidanceGenerationRef.current) return;
      setCameraState('error');
      setCameraMessage(error?.name === 'NotAllowedError' ? '未取得相機權限，仍可使用照片上傳' : '此裝置無法啟動相機，仍可使用照片上傳');
    }
  };

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
    if (!file || submitInFlightRef.current || submitStateRef.current === 'success') return;
    const requestId = (qualityRequestIds.current[slot] || 0) + 1;
    qualityRequestIds.current[slot] = requestId;
    const requestEpoch = qualityEpoch.current;
    const isCurrent = () => qualityRequestIds.current[slot] === requestId
      && qualityEpoch.current === requestEpoch
      && submitStateRef.current !== 'success';
    // Reset as soon as a new file is selected so no previous pass result can enable submission.
    setSubmitError(null);
    if (submitStateRef.current === 'error') setSubmissionState('idle');
    setCheckedPhotos(prev => ({ ...prev, [slot]: { status: 'checking', filename: file.name } }));
    if (phase === 'return') {
      setGuidance(null);
      setGuidanceStatus('checking');
    }

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
        if (phase === 'return') setGuidanceStatus('unavailable');
        return;
      }
      
      const basePayload = getPayload(slot, fileData);
      const response = await apiPost('/api/photos/quality-check', basePayload, { suppressErrorToast: true });
      if (!isCurrent()) return;
      
      setCheckedPhotos(prev => ({
        ...prev,
        [slot]: {
          status: 'passed',
          photoId: response.photoId,
          filename: basePayload.filename,
          previewUrl: response.photo?.filePath ? `/${response.photo.filePath}` : fileData.data,
          feSharpness: blurMetrics.variance,
          feWallTime: blurMetrics.wallTime,
          precheck,
          quality: response.quality
        }
      }));

      // Damage verification must start immediately after the persisted quality-check
      // response. Do not serialize it behind return-phase guidance: CPU Qwen inference
      // can be slow and the quality badge is not evidence that damage review completed.
      const conditionCheck = apiPost('/api/photos/condition-check', { photoId: response.photoId }, {
        suppressErrorToast: true,
        timeoutMs: 120_000
      }).then(damageResponse => {
        if (!isCurrent()) return;
        setCheckedPhotos(prev => ({ ...prev, [slot]: { ...prev[slot], damage: damageResponse.damage as DamageResult } }));
      }).catch(() => {
        if (!isCurrent()) return;
        setCheckedPhotos(prev => ({ ...prev, [slot]: { ...prev[slot], damage: {
          damage_status: 'unavailable', detection_count: 0, confidence: null, detections: [],
          inference_status: 'failed', failure_reason: 'CONDITION_CHECK_UNAVAILABLE'
        } } }));
      });

      if (phase === 'return') {
        try {
          const guidanceResponse = await apiPost('/api/photos/capture-guidance', { ...basePayload, photoId: response.photoId }, { suppressErrorToast: true });
          if (!isCurrent()) return;
          const nextGuidance = guidanceResponse.guidance as GuidanceResult;
          setCheckedPhotos(prev => ({ ...prev, [slot]: { ...prev[slot], guidance: nextGuidance } }));
          setGuidance(nextGuidance);
          setGuidanceStatus(nextGuidance.guidance_status === 'FULL' ? 'full' : nextGuidance.guidance_status === 'DEGRADED' ? 'degraded' : 'unavailable');
        } catch {
          if (!isCurrent()) return;
          setGuidance(null);
          setGuidanceStatus('unavailable');
        }
      }

      await conditionCheck;

      showToast("照片品質檢查完成", `${slot}: ${response.quality.message}`, CUSTOMER_SUBMISSION_TOAST_SCOPE);
    } catch (error: any) {
      if (!isCurrent()) return;
      const quality = error.payload?.quality;
      const isBlurFailure = error.code === 'IMAGE_TOO_BLURRY';
      const isVehicleFailure = error.code === 'NO_VEHICLE_DETECTED';
      const errorMessage = isBlurFailure
        ? '照片過於模糊，請重新拍攝後再上傳。'
        : isVehicleFailure ? '未偵測到足夠清晰的車輛，請重新拍攝，確保車輛完整入鏡且光線充足。' : '目前無法完成照片品質檢查，請重新嘗試。';
      if (phase === 'return') setGuidanceStatus('unavailable');
      setCheckedPhotos(prev => ({
        ...prev,
        [slot]: {
          status: isBlurFailure || isVehicleFailure ? 'failed' : 'error',
          filename: file.name,
          previewUrl: prev[slot]?.previewUrl,
          feSharpness: prev[slot]?.feSharpness,
          feWallTime: prev[slot]?.feWallTime,
          precheck: prev[slot]?.precheck,
          quality,
          errorMessage
        }
      }));
      showToast(isBlurFailure ? '照片模糊' : isVehicleFailure ? '未偵測到車輛' : '品質檢查失敗', errorMessage, CUSTOMER_SUBMISSION_TOAST_SCOPE);
    }
  };

  const resetPhotos = () => {
    invalidateQualityRequests();
    setSubmitError(null);
    if (submitStateRef.current === 'error') setSubmissionState('idle');
    setCheckedPhotos({});
    setGuidance(null);
    setGuidanceStatus('idle');
  };

  const submitPhotoFlow = async () => {
    if (submitInFlightRef.current || submitStateRef.current === 'success') return;
    const allPhotosPassed = PHOTO_SLOTS.every(slot => {
      const checked = checkedPhotos[slot.key];
      return checked?.status === 'passed' && Boolean(checked.photoId) && checked.quality?.blur.passed;
    });
    if (!allPhotosPassed) {
      const message = '所有必填照片都必須先通過後端品質檢查。';
      setSubmitError(message);
      setSubmissionState('error');
      clearToasts(CUSTOMER_SUBMISSION_TOAST_SCOPE);
      showToast('尚未完成照片檢查', message, CUSTOMER_SUBMISSION_TOAST_SCOPE);
      return;
    }
    if (phase === 'return' && (!returnLocation.address.trim() || !returnLocation.parkingSlot.trim())) {
      const message = '還車時請填寫地址與車格號碼；若為路邊停車，車格可填「路邊停車」。';
      setSubmitError(message);
      setSubmissionState('error');
      showToast('停車位置尚未完成', message, CUSTOMER_SUBMISSION_TOAST_SCOPE);
      return;
    }
    const requestId = ++submissionRequestId.current;
    submitInFlightRef.current = true;
    setSubmissionState('submitting');
    setSubmitError(null);
    setShowSuccessModal(false);
    setLastSubmission(null);
    clearToasts(CUSTOMER_SUBMISSION_TOAST_SCOPE);
    
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
      returnLocation: phase === 'return' ? returnLocation : undefined,
      photos
    };

    try {
      const response = await apiPost('/api/photo-submissions', payload, { suppressErrorToast: true });
      if (requestId !== submissionRequestId.current) return;
      // A backend success response is the sole source of truth for a completed submission.
      invalidateQualityRequests();
      clearToasts(CUSTOMER_SUBMISSION_TOAST_SCOPE);
      setSubmitError(null);
      setLastSubmission({
        submissionId: response.submissionId,
        overallStatus: response.overallStatus,
        createdIncidents: response.createdIncidents,
        title: response.createdIncidents.length ? '已送出，需營運端確認' : '已送出，未偵測異常',
        body: `提交編號 ${response.submissionId}，AI 狀態 ${response.overallStatus}。`
      });
      setSubmissionState('success');
      setShowSuccessModal(true);
    } catch (error: any) {
      if (requestId !== submissionRequestId.current) return;
      const isQualityFailure = error.code === 'IMAGE_QUALITY_CHECK_FAILED';
      const title = isQualityFailure ? '照片品質檢查未通過' : '送出失敗';
      const message = error.message || '目前無法完成送出，請重新嘗試。';
      setSubmitError(message);
      setSubmissionState('error');
      setShowSuccessModal(false);
      clearToasts(CUSTOMER_SUBMISSION_TOAST_SCOPE);
      showToast(title, message, CUSTOMER_SUBMISSION_TOAST_SCOPE);
    } finally {
      if (requestId === submissionRequestId.current) submitInFlightRef.current = false;
    }
  };

  const closeSuccessModal = () => {
    setShowSuccessModal(false);
    setSubmissionState('idle');
  };

  const submissionLocked = submitState === 'submitting' || submitState === 'success';

  const switchIdentity = async () => {
    await auth.logout();
    navigate('/login', { replace: true });
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
          <button type="button"
            onClick={() => void switchIdentity()}
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
              type="button"
              disabled={submissionLocked}
              onClick={() => switchPhase('pickup')}
              className={`border-0 rounded-xl min-h-[42px] font-extrabold text-sm transition-all duration-200 disabled:opacity-50 ${phase === 'pickup' ? 'bg-irent-red text-white shadow-lg' : 'text-irent-muted hover:text-irent-red'}`}
            >
              取車檢查
            </button>
            <button
              type="button"
              disabled={submissionLocked}
              onClick={() => switchPhase('return')}
              className={`border-0 rounded-xl min-h-[42px] font-extrabold text-sm transition-all duration-200 disabled:opacity-50 ${phase === 'return' ? 'bg-irent-red text-white shadow-lg' : 'text-irent-muted hover:text-irent-red'}`}
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

          {phase === 'return' && (
            <section className="overflow-hidden rounded-2xl border border-irent-line bg-white shadow-sm" aria-labelledby="continuous-guidance-title">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 id="continuous-guidance-title" className="m-0 text-sm font-black text-irent-ink">相機即時引導</h3>
                  <p className="m-0 mt-1 text-xs text-irent-muted">{cameraState === 'streaming' ? `即時引導中 · ${cameraMessage}` : cameraMessage || '啟動後會約每 0.45 秒更新 AI 視角'}</p>
                </div>
                {cameraState === 'streaming' || cameraState === 'starting' ? (
                  <button type="button" onClick={stopContinuousGuidance} className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl border border-irent-line bg-white px-4 text-sm font-extrabold text-irent-ink"><CameraOff size={17} /> 停止相機</button>
                ) : (
                  <button type="button" onClick={() => void startContinuousGuidance()} disabled={submissionLocked} className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl border-0 bg-irent-red px-4 text-sm font-extrabold text-white disabled:opacity-50"><Camera size={17} /> 啟動即時引導</button>
                )}
              </div>
              <div className={`${cameraState === 'streaming' ? 'block' : 'hidden'} bg-slate-950`}>
                <video ref={videoRef} muted playsInline className="aspect-video max-h-[360px] w-full object-contain" aria-label="即時相機預覽" />
              </div>
              <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
            </section>
          )}

          {phase === 'return' && (
            <Vehicle3DViewer
              aiPose={guidance?.success && guidance.guidance_status !== 'UNAVAILABLE' ? guidance.viewer_pose : undefined}
              guidanceStatus={guidanceStatus}
              guidanceSummary={guidance ? {
                inlierCount: guidance.inlier_count,
                correspondenceCount: guidance.correspondence_count,
                reprojectionError: guidance.reprojection_error,
                yaw: guidance.yaw,
                pitch: guidance.guidance_status === 'FULL' ? guidance.pitch : undefined,
                distance: guidance.guidance_status === 'FULL' ? guidance.distance : undefined,
                solverUsed: guidance.solver_used,
                degradationReason: guidance.degradation_reason,
              } : undefined}
            />
          )}

          {phase === 'return' && (
            <section className="rounded-2xl border border-irent-line bg-white p-4 shadow-sm" aria-labelledby="coverage-title">
              <div className="flex items-end justify-between gap-3">
                <div><h3 id="coverage-title" className="m-0 text-sm font-black text-irent-ink">拍攝涵蓋率</h3><p className="m-0 mt-1 text-xs text-irent-muted">依可靠方位做 8 區去重累積</p></div>
                <strong className="text-2xl text-irent-red">{coverage.percentage.toFixed(1)}%</strong>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-irent-red transition-all" style={{ width: `${coverage.percentage}%` }} /></div>
              <p className="m-0 mt-3 text-xs text-irent-muted">已覆蓋：{coverage.covered.length ? coverage.covered.map(sector => SECTOR_LABELS[sector]).join('、') : '尚無'}</p>
              <p className="m-0 mt-1 text-xs text-irent-muted">缺少：{coverage.missing.length ? coverage.missing.map(sector => SECTOR_LABELS[sector]).join('、') : '無'}</p>
              <p className="m-0 mt-2 text-sm font-extrabold text-irent-ink">建議下一拍：{coverage.next ? SECTOR_LABELS[coverage.next] : '已完成全部方向'}</p>
            </section>
          )}

          {phase === 'return' && (
            <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 flex flex-col gap-3" aria-labelledby="return-location-title">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div><h3 id="return-location-title" className="m-0 text-sm font-black text-irent-ink">停車位置</h3><p className="m-0 mt-1 text-xs text-irent-muted">位置只在還車時取得一次，用於確認還車地點與後續派工。</p></div>
                <button type="button" onClick={captureGps} disabled={gpsState === 'capturing' || submissionLocked} className="min-h-[38px] rounded-xl border border-blue-300 bg-white px-3 text-xs font-bold text-blue-800 disabled:opacity-50">{gpsState === 'capturing' ? '正在定位...' : '重新定位'}</button>
              </div>
              {gpsMessage && <p className={`m-0 text-xs font-bold ${gpsState === 'unavailable' ? 'text-amber-800' : 'text-blue-800'}`}>{gpsState === 'captured' ? '✓ ' : ''}{gpsMessage}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <LocationInput label="地址 *" hint="請輸入實際停車場地址或還車站點地址" value={returnLocation.address} onChange={value => updateReturnLocation('address', value)} />
                <LocationInput label="停車場 / 站點" hint="例如：中山大學地下停車場" value={returnLocation.parkingFacility || returnLocation.station} onChange={value => updateReturnLocation('parkingFacility', value)} />
                <LocationInput label="樓層" hint="例如：1F、B1、B2、B3" value={returnLocation.floor} onChange={value => updateReturnLocation('floor', value)} />
                <LocationInput label="區域" hint="例如：A區" value={returnLocation.zone} onChange={value => updateReturnLocation('zone', value)} />
                <LocationInput label="柱號" hint="若有柱號，請輸入，例如 A-12" value={returnLocation.pillar} onChange={value => updateReturnLocation('pillar', value)} />
                <LocationInput label="車格號碼 *" hint="例如：100、A105；路邊可填路邊停車" value={returnLocation.parkingSlot} onChange={value => updateReturnLocation('parkingSlot', value)} />
              </div>
              <LocationInput label="補充資訊" hint="例如：靠近電梯、出口、充電樁、服務台" value={returnLocation.locationNote} onChange={value => updateReturnLocation('locationNote', value)} multiline />
            </section>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-extrabold text-irent-muted">備註</label>
            <textarea 
              value={note} 
              onChange={e => setNote(e.target.value)}
              placeholder="可補充本次拍攝或還車狀況。"
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
                : checked?.status === 'failed' ? '✕ 照片未通過，請重新拍攝'
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
                        disabled={submissionLocked}
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
                  {checked?.guidance && <p className="m-0 text-xs font-bold text-irent-muted">拍攝方向：{checked.guidance.view_sector ? SECTOR_LABELS[checked.guidance.view_sector] : '無法判定'}{checked.guidance.guidance_status === 'DEGRADED' ? '（粗略）' : ''}</p>}
                  {checked?.damage && <p className={`m-0 text-xs font-bold ${checked.damage.damage_status === 'detected' ? 'text-irent-red' : 'text-irent-muted'}`}>
                    車損辨識：{checked.damage.inference_status === 'failed' ? 'Qwen 覆核暫時不可用（不顯示未驗證候選）' : checked.damage.damage_status === 'detected' ? `Qwen 驗證通過 ${checked.damage.detections.filter(item => item.verification?.is_damage).length} 處` : '未偵測到經驗證的車損'}
                  </p>}

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
              type="button"
              onClick={submitPhotoFlow}
              disabled={submissionLocked || (phase === 'return' && (!returnLocation.address.trim() || !returnLocation.parkingSlot.trim())) || !PHOTO_SLOTS.every(slot => {
                const checked = checkedPhotos[slot.key];
                return checked?.status === 'passed' && Boolean(checked.photoId) && checked.quality?.blur.passed;
              })}
              className="w-full min-h-[44px] rounded-2xl border border-irent-red bg-irent-red text-white font-extrabold text-sm hover:shadow-hover hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {submitState === 'submitting' ? '送出中...' : '完成送出'}
            </button>
            {submitState === 'error' && submitError && <p role="alert" className="m-0 rounded-xl border border-[#fde5e5] bg-[#fff3f3] px-3 py-2 text-xs font-bold text-irent-red">{submitError}</p>}
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

      {showSuccessModal && lastSubmission && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="submission-success-title">
          <section className="w-full max-w-sm rounded-3xl border border-irent-line bg-white p-7 text-center shadow-2xl">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e9f4ea] text-irent-green"><CheckCircle2 size={34} strokeWidth={2.5} /></span>
            <h2 id="submission-success-title" className="mb-2 mt-4 text-xl font-black text-irent-ink">{phase === 'pickup' ? '取車檢查成功' : '還車檢查成功'}</h2>
            <p className="m-0 text-sm text-irent-muted">照片已成功送出</p>
            <p className="mt-4 rounded-xl bg-irent-bg px-3 py-2 font-mono text-xs font-bold text-irent-ink break-all">{lastSubmission.submissionId}</p>
            <button type="button" onClick={closeSuccessModal} className="mt-5 min-h-11 w-full rounded-xl bg-irent-red px-5 font-extrabold text-white transition-colors hover:bg-red-700">完成</button>
          </section>
        </div>
      )}

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

const LocationInput: React.FC<{ label: string; hint: string; value: string; onChange: (value: string) => void; multiline?: boolean }> = ({ label, hint, value, onChange, multiline }) => (
  <label className="flex flex-col gap-1.5 text-xs font-extrabold text-irent-muted">
    {label}
    {multiline ? <textarea value={value} maxLength={500} onChange={event => onChange(event.target.value)} className="min-h-[72px] w-full rounded-xl border border-blue-400 bg-white p-3 text-sm font-normal text-irent-ink focus:outline-none focus:ring-3 focus:ring-blue-100" /> : <input value={value} maxLength={180} onChange={event => onChange(event.target.value)} className="min-h-[42px] w-full rounded-xl border border-blue-400 bg-white px-3 text-sm font-normal text-irent-ink focus:outline-none focus:ring-3 focus:ring-blue-100" />}
    <small className="font-normal text-[10px] text-irent-muted">{hint}</small>
  </label>
);
