import { createHash, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { DatabaseRepository } from '../repositories/DatabaseRepository';
import { UserRole } from '../models/types';
import { CSRF_COOKIE, parseCookies, SESSION_COOKIE } from './cookies';
import { AuthService } from './AuthService';

export function configuredOrigins(): string[] {
  const configured = String(process.env.CORS_ORIGIN || '').split(',').map(item => item.trim()).filter(Boolean);
  if (configured.length) return configured;
  return process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
}

export function isAllowedOrigin(req: Request, origin: string): boolean {
  const normalized = origin.replace(/\/$/, '');
  const sameOrigin = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
  return normalized === sameOrigin || configuredOrigins().includes(normalized);
}

export function attachAuthentication(repo: DatabaseRepository) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = parseCookies(req.header('cookie'))[SESSION_COOKIE];
    if (!token) return next();
    const tokenHash = AuthService.hashOpaqueToken(token);
    const session = repo.getAuthSession(tokenHash);
    if (!session || session.revoked_at || session.expires_at <= new Date().toISOString() || !session.is_active) {
      return next();
    }
    req.authUser = { id: session.user_id, email: session.email, role: session.role };
    req.authSession = session;
    req.authSessionToken = token;
    repo.touchAuthSession(tokenHash);
    next();
  };
}

export function loginRequired(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

export function roleRequired(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    if (!roles.includes(req.authUser.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    next();
  };
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.header('origin');
  if (origin && !isAllowedOrigin(req, origin)) return res.status(403).json({ ok: false, error: 'Invalid CSRF token' });

  const cookieToken = parseCookies(req.header('cookie'))[CSRF_COOKIE] || '';
  const headerToken = req.header('x-csrf-token') || '';
  const left = Buffer.from(cookieToken);
  const right = Buffer.from(headerToken);
  if (!left.length || left.length !== right.length || !timingSafeEqual(left, right)) {
    return res.status(403).json({ ok: false, error: 'Invalid CSRF token' });
  }

  if (req.authSession) {
    const headerHash = createHash('sha256').update(headerToken, 'utf8').digest('hex');
    const stored = Buffer.from(req.authSession.csrf_token_hash);
    const actual = Buffer.from(headerHash);
    if (stored.length !== actual.length || !timingSafeEqual(stored, actual)) {
      return res.status(403).json({ ok: false, error: 'Invalid CSRF token' });
    }
  }
  next();
}
