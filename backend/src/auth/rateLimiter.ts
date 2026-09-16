import { Request, Response, NextFunction } from 'express';

interface Attempt { count: number; firstAt: number; blockedUntil: number; }

export class LoginRateLimiter {
  private readonly attempts = new Map<string, Attempt>();
  private readonly windowMs = 15 * 60 * 1000;
  private readonly blockMs = 15 * 60 * 1000;
  private readonly maxAttempts = 5;

  private key(req: Request) {
    const username = String(req.body?.username || '').trim().toLowerCase().slice(0, 32);
    return `${req.ip}|${username}`;
  }

  public middleware = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const item = this.attempts.get(this.key(req));
    if (item?.blockedUntil && item.blockedUntil > now) {
      res.set('Retry-After', String(Math.ceil((item.blockedUntil - now) / 1000)));
      return res.status(429).json({ ok: false, error: '登入嘗試次數過多，請稍後再試。' });
    }
    if (item && now - item.firstAt >= this.windowMs) this.attempts.delete(this.key(req));
    next();
  };

  public recordFailure(req: Request) {
    const key = this.key(req);
    const now = Date.now();
    const current = this.attempts.get(key);
    const item = !current || now - current.firstAt >= this.windowMs
      ? { count: 0, firstAt: now, blockedUntil: 0 }
      : current;
    item.count += 1;
    if (item.count >= this.maxAttempts) item.blockedUntil = now + this.blockMs;
    this.attempts.set(key, item);
  }

  public clear(req: Request) {
    this.attempts.delete(this.key(req));
  }
}
