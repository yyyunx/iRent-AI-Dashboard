import { Response } from 'express';

export const SESSION_COOKIE = 'irent_session';
export const CSRF_COOKIE = 'irent_csrf';

type SameSite = 'Lax' | 'Strict' | 'None';

function cookiePolicy() {
  const production = process.env.NODE_ENV === 'production';
  const configured = String(process.env.COOKIE_SAME_SITE || 'Lax').toLowerCase();
  const sameSite: SameSite = configured === 'none' ? 'None' : configured === 'strict' ? 'Strict' : 'Lax';
  if (sameSite === 'None' && !production) {
    throw new Error('COOKIE_SAME_SITE=None requires production HTTPS cookies.');
  }
  return { secure: production, sameSite };
}

function serializeCookie(name: string, value: string, options: { httpOnly: boolean; maxAgeSeconds: number }) {
  const policy = cookiePolicy();
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    `SameSite=${policy.sameSite}`
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (policy.secure) parts.push('Secure');
  return parts.join('; ');
}

export function setAuthCookies(res: Response, sessionToken: string, csrfToken: string, maxAgeSeconds: number) {
  res.append('Set-Cookie', serializeCookie(SESSION_COOKIE, sessionToken, { httpOnly: true, maxAgeSeconds }));
  res.append('Set-Cookie', serializeCookie(CSRF_COOKIE, csrfToken, { httpOnly: false, maxAgeSeconds }));
}

export function setCsrfCookie(res: Response, csrfToken: string, maxAgeSeconds?: number) {
  const configured = Number(process.env.SESSION_TTL_SECONDS || 28800);
  const ttl = maxAgeSeconds ?? (Number.isFinite(configured) ? Math.min(Math.max(configured, 900), 604800) : 28800);
  res.append('Set-Cookie', serializeCookie(CSRF_COOKIE, csrfToken, { httpOnly: false, maxAgeSeconds: ttl }));
}

export function clearAuthCookies(res: Response) {
  res.append('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { httpOnly: true, maxAgeSeconds: 0 }));
  res.append('Set-Cookie', serializeCookie(CSRF_COOKIE, '', { httpOnly: false, maxAgeSeconds: 0 }));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return [part.trim(), ''];
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      return [name, decodeURIComponent(value)];
    } catch {
      return [name, ''];
    }
  }));
}
