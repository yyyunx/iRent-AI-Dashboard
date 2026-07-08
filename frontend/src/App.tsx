import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { ToastContainer } from './components/ToastContainer';

// Lazy loading views for page chunking
const RoleSelection = React.lazy(() => import('./pages/RoleSelection'));
const CustomerFlow = React.lazy(() => import('./pages/CustomerFlow'));
const OperatorLayout = React.lazy(() => import('./pages/operator/OperatorLayout'));
const Dashboard = React.lazy(() => import('./pages/operator/Dashboard'));
const Submissions = React.lazy(() => import('./pages/operator/Submissions'));
const MapView = React.lazy(() => import('./pages/operator/MapView'));
const Tasks = React.lazy(() => import('./pages/operator/Tasks'));
const Notifications = React.lazy(() => import('./pages/operator/Notifications'));
const Analytics = React.lazy(() => import('./pages/operator/Analytics'));
const Settings = React.lazy(() => import('./pages/operator/Settings'));

// Standard loading fallback for chunk resolve
const PageLoader: React.FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
    <div className="w-10 h-10 border-4 border-irent-red/10 border-t-irent-red rounded-full animate-spin" />
    <span className="text-xs font-bold text-irent-muted">頁面載入中...</span>
  </div>
);

const App: React.FC = () => {
  return (
    <AppProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<RoleSelection />} />
            <Route path="/customer" element={<CustomerFlow />} />
            
            {/* Operator sub-pages */}
            <Route path="/operator" element={<OperatorLayout />}>
              <Route index element={<Navigate to="/operator/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="submissions" element={<Submissions />} />
              <Route path="map" element={<MapView />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="settings" element={<Settings />} />
            </Route>

            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <ToastContainer />
    </AppProvider>
  );
};

export default App;
