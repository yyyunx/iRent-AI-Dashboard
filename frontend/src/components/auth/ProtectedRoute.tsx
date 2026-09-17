import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthRole, useAuth } from '../../context/AuthContext';

const AuthLoader = () => <div className="min-h-screen grid place-items-center bg-irent-bg"><div className="w-10 h-10 border-4 border-irent-red/10 border-t-irent-red rounded-full animate-spin" /></div>;

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading) return <AuthLoader />;
  if (!auth.isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
};

export const RequireRole: React.FC<{ roles: AuthRole[]; children: React.ReactNode }> = ({ roles, children }) => {
  const auth = useAuth();
  if (auth.isLoading) return <AuthLoader />;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (!roles.includes(auth.user.role)) return <Navigate to="/403" replace />;
  return <>{children}</>;
};
