import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type AuthRole = 'user' | 'operator' | 'admin';
export interface AuthUser { id: number; username: string; role: AuthRole; }

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
  getCsrfToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [csrfToken, setCsrfToken] = useState('');

  const refreshCsrfToken = useCallback(async () => {
    const response = await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('無法初始化安全驗證，請重新整理頁面。');
    const data = await response.json();
    setCsrfToken(data.csrfToken);
    return data.csrfToken as string;
  }, []);

  const getCsrfToken = useCallback(async () => csrfToken || refreshCsrfToken(), [csrfToken, refreshCsrfToken]);

  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    try {
      await refreshCsrfToken();
      const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) {
        setUser(null);
        return null;
      }
      const data = await response.json();
      setUser(data.user);
      return data.user as AuthUser;
    } finally {
      setIsLoading(false);
    }
  }, [refreshCsrfToken]);

  const login = useCallback(async (username: string, password: string) => {
    const token = csrfToken || await getCsrfToken();
    const response = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登入失敗');
    setCsrfToken(data.csrfToken);
    setUser(data.user);
    return data.user as AuthUser;
  }, [csrfToken, getCsrfToken]);

  const logout = useCallback(async () => {
    try {
      const token = csrfToken || await getCsrfToken();
      await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: '{}'
      });
    } finally {
      setUser(null);
      setCsrfToken('');
    }
  }, [csrfToken, getCsrfToken]);

  useEffect(() => { void refreshUser(); }, [refreshUser]);

  const value = useMemo(() => ({ user, isAuthenticated: Boolean(user), isLoading, login, logout, refreshUser, getCsrfToken }), [user, isLoading, login, logout, refreshUser, getCsrfToken]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
