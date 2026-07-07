import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

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
  isBlur: boolean;
  plateVisible: boolean;
  angleValid: boolean;
  distanceValid: boolean;
  aiResult: any;
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
}

export interface AppState {
  incidents: Incident[];
  damageHotspots: [string, number][];
  lineGroup: string;
  slackConnected: boolean;
  slackWebhook: string;
  lineLogs: { title: string; time: string; group: string; message: string }[];
  timelines: Record<string, TimelineItem[]>;
  comments: Record<string, CommentItem[]>;
  slackNotifications: any[];
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
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  currentRole: 'customer' | 'operator' | null;
  setCurrentRole: (role: 'customer' | 'operator' | null) => void;
  toastStack: Toast[];
  showToast: (title: string, text: string) => void;
  removeToast: (id: string) => void;
  refreshState: () => Promise<boolean>;
  apiPost: (path: string, payload: any) => Promise<any>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<'customer' | 'operator' | null>(null);
  const [toastStack, setToastStack] = useState<Toast[]>([]);

  const showToast = useCallback((title: string, text: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToastStack(prev => [{ id, title, text }, ...prev]);
    setTimeout(() => {
      setToastStack(prev => prev.filter(t => t.id !== id));
    }, 5200);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToastStack(prev => prev.filter(t => t.id !== id));
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) return false;
      const data = await response.json();
      setState(data);
      if (data.incidents && data.incidents.length > 0 && !selectedId) {
        // Find first active or first incident
        const active = data.incidents.find((i: Incident) => i.status !== 'resolved' && i.status !== 'done');
        setSelectedId(active ? active.id : data.incidents[0].id);
      }
      return true;
    } catch (error) {
      console.error("Failed to load state", error);
      return false;
    }
  }, [selectedId]);

  const apiPost = useCallback(async (path: string, payload: any) => {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "API request failed");
      }
      if (data.state) {
        setState(data.state);
      }
      return data;
    } catch (error: any) {
      showToast("連線錯誤", error.message || "請求失敗");
      throw error;
    }
  }, [showToast]);

  // Initial load
  useEffect(() => {
    refreshState();
  }, []);

  // Poll state every 3 seconds if active (unless inputs are active, handled in the components)
  useEffect(() => {
    const interval = setInterval(() => {
      // Check if user is typing in common inputs to prevent layout refresh jitter
      const activeEl = document.activeElement?.id;
      const typingInputs = ["commentText", "photoNote", "customerPhotoNote", "reportNote"];
      if (activeEl && typingInputs.includes(activeEl)) {
        return;
      }
      refreshState();
    }, 3000);

    return () => clearInterval(interval);
  }, [refreshState]);

  return (
    <AppContext.Provider
      value={{
        state,
        selectedId,
        setSelectedId,
        currentRole,
        setCurrentRole,
        toastStack,
        showToast,
        removeToast,
        refreshState,
        apiPost
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
