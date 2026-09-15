import argon2 from 'argon2';
import type { HashOptions } from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { DatabaseRepository } from '../repositories/DatabaseRepository';
import { SafeUser, UserRole } from '../models/types';

const ARGON2_OPTIONS: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
};

export class AuthService {
  private readonly dummyHash: Promise<string>;
  private readonly sessionTtlSeconds: number;

  constructor(private readonly repo: DatabaseRepository) {
    this.dummyHash = argon2.hash(randomBytes(32), ARGON2_OPTIONS);
    const configured = Number(process.env.SESSION_TTL_SECONDS || 28800);
    this.sessionTtlSeconds = Number.isFinite(configured) ? Math.min(Math.max(configured, 900), 604800) : 28800;
  }

  public static hashOpaqueToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  public static newOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  public async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  public async createUser(email: string, password: string, role: UserRole, isActive = true) {
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error('A valid email is required.');
    if (password.length < 12 || password.length > 256) throw new Error('Password must contain 12 to 256 characters.');
    return this.repo.createUser(email, await this.hashPassword(password), role, isActive);
  }

  public async login(email: string, password: string, priorSessionToken?: string) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const candidatePassword = String(password || '');
    const validShape = normalizedEmail.length <= 254 && candidatePassword.length > 0 && candidatePassword.length <= 256;
    const user = validShape ? this.repo.getUserByEmail(normalizedEmail) : null;
    const hash = user?.password_hash || await this.dummyHash;
    const verified = await argon2.verify(hash, candidatePassword.slice(0, 256)).catch(() => false);

    if (!user || !verified || !user.is_active) return null;

    // Rotation is unconditional: a token supplied before login can never survive login.
    if (priorSessionToken) this.repo.revokeAuthSession(AuthService.hashOpaqueToken(priorSessionToken));
    const sessionToken = AuthService.newOpaqueToken();
    const csrfToken = AuthService.newOpaqueToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000).toISOString();
    this.repo.createAuthSession(
      user.id,
      AuthService.hashOpaqueToken(sessionToken),
      AuthService.hashOpaqueToken(csrfToken),
      expiresAt
    );
    this.repo.updateUserLastLogin(user.id);
    this.repo.addAuditLog(user.id, 'LOGIN', 'session', undefined, {});
    return { sessionToken, csrfToken, maxAgeSeconds: this.sessionTtlSeconds, user: this.safeUser(user) };
  }

  public logout(sessionToken: string, userId: number) {
    const revoked = this.repo.revokeAuthSession(AuthService.hashOpaqueToken(sessionToken));
    if (revoked) this.repo.addAuditLog(userId, 'LOGOUT', 'session', undefined, {});
    return revoked;
  }

  public rotateCsrf(sessionToken: string) {
    const csrfToken = AuthService.newOpaqueToken();
    this.repo.updateAuthSessionCsrf(AuthService.hashOpaqueToken(sessionToken), AuthService.hashOpaqueToken(csrfToken));
    return csrfToken;
  }

  public safeUser(user: { id: number; email: string; role: UserRole }): SafeUser {
    return { id: user.id, email: user.email, role: user.role };
  }
}
