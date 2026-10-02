import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';

export interface Incident {
  id: string;
  plate: string;
  station: string;
  type: string;
  label: string;
  severity: string;
  confidence: number;
  time: string;
  nextBooking: number;
  hotStation: boolean;
  x: number;
  y: number;
  assignee: string;
  status: string;
  score: number;
  region: string;
  assignedTeam: string;
  autoClosed: boolean;
  aiReviewConfidence: number | null;
  aiReviewResult: string | null;
  aiReviewSummary: string | null;
  manualReviewRequired: boolean;
  resolvedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  address: string;
  parkingFacility: string;
  floor: string;
  zone: string;
  pillar: string;
  parkingSlot: string;
  locationNote: string;
  operationalUrgency: string | null;
  slaMinutes: number | null;
  vehicleUnavailable: boolean;
}

export interface PhotoSubmission {
  submissionId: string;
  rentalId: string;
  plate: string;
  phase: string;
  station: string;
  parkingLocation: string;
  status: string;
  overallStatus: string;
  aiSummary: string | null;
  createdAt: string;
  returnLocation: {
    latitude: number | null; longitude: number | null; gpsAccuracy: number | null; gpsCapturedAt: string | null;
    address: string; station: string; parkingFacility: string; floor: string; zone: string; pillar: string; parkingSlot: string; locationNote: string;
  };
  photos?: UploadedPhoto[];
}

export interface UploadedPhoto {
  photoId: string;
  submissionId: string | null;
  rentalId: string;
  plate: string;
  phase: string;
  slot: string;
  filename: string;
  filePath: string | null;
  qualityPassed: boolean;
  blurScore: number | null;
  blurThreshold: number | null;
  blurCheckedAt: string | null;
  isBlur: boolean;
  plateVisible: boolean;
  angleValid: boolean;
  distanceValid: boolean;
  aiResult: any;
  orientation: { angle: number | null; label: string | null; confidence: number | null; passed: boolean | null; checkedAt: string | null; };
  condition: { damageDetected: boolean | null; damageType: string | null; damageConfidence: number | null; dirtyDetected: boolean | null; dirtyConfidence: number | null; checkedAt: string | null; };
  createdAt: string;
}

export interface TimelineItem {
  id: number;
  incident_id: string;
  event_type: string;
  title: string;
  body: string | null;
  created_at: string;
}

export interface CommentItem {
  id: number;
  incident_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface MaintenanceReportItem {
  id: number;
  incident_id: string;
  photo_path: string | null;
  result: string;
  note: string | null;
  ai_review_result: string | null;
  ai_review_confidence: number | null;
  ai_review_summary: string | null;
  created_at: string;
}

export interface Toast {
  id: string;
  title: string;
  text: string;
  scope?: string;
}

export interface AppState {
  incidents: Incident[];
  damageHotspots: [string, number][];
  lineGroup: string;
  lineConfig: {
    enabled: boolean;
    groupName: string;
    targetId: string;
    targetConfigured: boolean;
    tokenConfigured: boolean;
    connected: boolean;
    webhookConfigured: boolean;
    targetSource: 'environment' | 'dashboard';
  };
  aiConfig: {
    provider: 'google-gemini';
    model: string;
    keyConfigured: boolean;
    keySource: 'environment' | 'dashboard';
  };
  inspectionConfig: { orientationCheckEnabled: boolean; conditionCheckEnabled: boolean; };
  lineLogs: { title: string; time: string; group: string; message: string; status: string; error: string | null }[];
  timelines: Record<string, TimelineItem[]>;
  comments: Record<string, CommentItem[]>;
  notificationStats: { provider: string; status: string; count: number }[];
  maintenanceReports: Record<string, MaintenanceReportItem[]>;
  photoSubmissions: PhotoSubmission[];
  uploadedPhotos: UploadedPhoto[];
  opsMetrics: {
    autoCloseRate: string;
    manualReviewReduced: number;
    avgTimeSaved: string;
  };
}

interface AppContextType {
  state: AppState | null;
  isLoading: boolean;
  loadError: string | null;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  toastStack: Toast[];
  showToast: (title: string, text: string, scope?: string) => void;
  removeToast: (id: string) => void;
  clearToasts: (scope: string) => void;
  refreshState: () => Promise<boolean>;
  apiPost: (path: string, payload: any, options?: { suppressErrorToast?: boolean; signal?: AbortSignal; timeoutMs?: number }) => Promise<any>;
  developerMode: boolean;
  setDeveloperMode: (val: boolean) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
const STATE_POLL_INTERVAL_MS = 15_000;

function replaceOrPrepend<T>(items: T[], value: T, key: (item: T) => string): T[] {
  const index = items.findIndex(item => key(item) === key(value));
  if (index < 0) return [value, ...items];
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading: authLoading, getCsrfToken, refreshUser } = useAuth();
  const [state, setState] = useState<AppState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toastStack, setToastStack] = useState<Toast[]>([]);
  const [developerMode, setDeveloperModeState] = useState<boolean>(() => {
    return localStorage.getItem('developerMode') === 'true';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const stateRequestInFlight = useRef(false);

  const setDeveloperMode = useCallback((val: boolean) => {
    setDeveloperModeState(val);
    localStorage.setItem('developerMode', String(val));
  }, []);

  const showToast = useCallback((title: string, text: string, scope?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToastStack(prev => [{ id, title, text, scope }, ...prev]);
    setTimeout(() => {
      setToastStack(prev => prev.filter(t => t.id !== id));
    }, 5200);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToastStack(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearToasts = useCallback((scope: string) => {
    setToastStack(prev => prev.filter(toast => toast.scope !== scope));
  }, []);

  const refreshState = useCallback(async () => {
    if (stateRequestInFlight.current) return false;
    // CustomerFlow consumes mutation responses directly and never renders the admin state.
    if (!isAuthenticated || user?.role !== 'admin') {
      setState(null);
      setIsLoading(false);
      return false;
    }
    stateRequestInFlight.current = true;
    try {
      const response = await fetch('/api/state', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 401) await refreshUser();
        setLoadError('資料載入失敗，請稍後再試。');
        return false;
      }
      const data = await response.json();
      setState(data);
      setLoadError(null);
      if (data.incidents && data.incidents.length > 0) {
        const active = data.incidents.find((i: Incident) => i.status !== 'resolved' && i.status !== 'done');
        setSelectedId(previous => previous || (active ? active.id : data.incidents[0].id));
      }
      return true;
    } catch (error) {
      console.error("Failed to load state", error);
      setLoadError('無法連線至營運資料服務。');
      return false;
    } finally {
      stateRequestInFlight.current = false;
      setIsLoading(false);
    }
  }, [isAuthenticated, user?.role, refreshUser]);

  const apiPost = useCallback(async (path: string, payload: any, options?: { suppressErrorToast?: boolean; signal?: AbortSignal; timeoutMs?: number }) => {
    const timeoutController = new AbortController();
    const timeout = options?.timeoutMs ? window.setTimeout(() => timeoutController.abort(), options.timeoutMs) : undefined;
    const abortFromCaller = () => timeoutController.abort();
    options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(path, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(payload),
        signal: timeoutController.signal
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        if (response.status === 401 || (response.status === 403 && data.error === 'Forbidden')) await refreshUser();
        const message = typeof data.error === 'string' ? data.error : data.error?.message || "API request failed";
        const error = Object.assign(new Error(message), { code: data.error?.code, payload: data, status: response.status });
        throw error;
      }
      if (data.state) {
        setState(data.state);
      } else if (data.changedResource) {
        setState(previous => {
          if (!previous) return previous;
          const changed = data.changedResource;
          if (changed.type === 'incident' && changed.data) {
            return { ...previous, incidents: replaceOrPrepend(previous.incidents, changed.data as Incident, item => item.id) };
          }
          if (changed.type === 'photo' && changed.data) {
            return { ...previous, uploadedPhotos: replaceOrPrepend(previous.uploadedPhotos, changed.data as UploadedPhoto, item => item.photoId) };
          }
          if (changed.type === 'submission' && changed.data) {
            const payload = changed.data as { submission: PhotoSubmission; photos: UploadedPhoto[]; incidents: Incident[] };
            return {
              ...previous,
              photoSubmissions: replaceOrPrepend(previous.photoSubmissions, payload.submission, item => item.submissionId),
              uploadedPhotos: payload.photos.reduce((items, photo) => replaceOrPrepend(items, photo, item => item.photoId), previous.uploadedPhotos),
              incidents: payload.incidents.reduce((items, incident) => replaceOrPrepend(items, incident, item => item.id), previous.incidents)
            };
          }
          if (changed.type === 'settings' && changed.data) {
            return changed.key === 'line'
              ? { ...previous, lineConfig: changed.data }
              : changed.key === 'ai' ? { ...previous, aiConfig: changed.data } : previous;
          }
          return previous;
        });
      }
      return data;
    } catch (error: any) {
      if (!options?.suppressErrorToast) showToast("連線錯誤", error.message || "請求失敗");
      throw error;
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', abortFromCaller);
    }
  }, [showToast, getCsrfToken, refreshUser]);

  // Initial load
  useEffect(() => {
    if (!authLoading) void refreshState();
  }, [authLoading, isAuthenticated, refreshState]);

  // Admin state is refreshed only on visible operator pages. Mutations update it immediately.
  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'admin') return;
    const interval = setInterval(() => {
      if (!window.location.pathname.startsWith('/operator') || document.visibilityState !== 'visible') return;
      // Check if user is typing in common inputs to prevent layout refresh jitter
      const activeEl = document.activeElement?.id;
      const typingInputs = ["commentText", "photoNote", "customerPhotoNote", "reportNote", "agentQuery", "aiApiKey", "aiModel"];
      if (activeEl && typingInputs.includes(activeEl)) {
        return;
      }
      void refreshState();
    }, STATE_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refreshState, isAuthenticated, user?.role]);

  return (
    <AppContext.Provider
      value={{
        state,
        isLoading,
        loadError,
        selectedId,
        setSelectedId,
        toastStack,
        showToast,
        removeToast,
        clearToasts,
        refreshState,
        apiPost,
        developerMode,
        setDeveloperMode,
        searchQuery,
        setSearchQuery
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
