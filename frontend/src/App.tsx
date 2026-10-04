import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastContainer } from './components/ToastContainer';
import { RequireRole } from './components/auth/ProtectedRoute';

// Lazy loading views for page chunking
const Login = React.lazy(() => import('./pages/Login'));
const Forbidden = React.lazy(() => import('./pages/Forbidden'));
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

const HomeRedirect: React.FC = () => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  return <Navigate to={user ? (user.role === 'user' ? '/customer' : '/operator/dashboard') : '/login'} replace />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppProvider>
        <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/403" element={<Forbidden />} />
            <Route path="/customer" element={<RequireRole roles={['user']}><CustomerFlow /></RequireRole>} />
            
            {/* Operator sub-pages */}
            <Route path="/operator" element={<RequireRole roles={['admin', 'operator']}><OperatorLayout /></RequireRole>}>
              <Route index element={<Navigate to="/operator/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="submissions" element={<Submissions />} />
              <Route path="map" element={<RequireRole roles={['admin', 'operator']}><MapView /></RequireRole>} />
              <Route path="tasks" element={<RequireRole roles={['admin', 'operator']}><Tasks /></RequireRole>} />
              <Route path="notifications" element={<RequireRole roles={['admin', 'operator']}><Notifications /></RequireRole>} />
              <Route path="analytics" element={<RequireRole roles={['admin']}><Analytics /></RequireRole>} />
              <Route path="settings" element={<RequireRole roles={['admin']}><Settings /></RequireRole>} />
            </Route>

            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </BrowserRouter>
        <ToastContainer />
      </AppProvider>
    </AuthProvider>
  );
};

export default App;
