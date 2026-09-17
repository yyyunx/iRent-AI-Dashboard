import { Request, Response } from 'express';
import { AuthService } from './AuthService';
import { clearAuthCookies, parseCookies, SESSION_COOKIE, setAuthCookies, setCsrfCookie } from './cookies';
import { LoginRateLimiter } from './rateLimiter';

export class AuthController {
  public readonly rateLimiter = new LoginRateLimiter();

  constructor(private readonly auth: AuthService) {}

  public csrf = (req: Request, res: Response) => {
    const csrfToken = req.authSessionToken
      ? this.auth.rotateCsrf(req.authSessionToken)
      : AuthService.newOpaqueToken();
    setCsrfCookie(res, csrfToken);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, csrfToken });
  };

  public login = async (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const prior = parseCookies(req.header('cookie'))[SESSION_COOKIE];
    const result = await this.auth.login(username, password, prior);
    if (!result) {
      this.rateLimiter.recordFailure(req);
      return res.status(401).json({ ok: false, error: '使用者名稱或密碼錯誤' });
    }
    this.rateLimiter.clear(req);
    setAuthCookies(res, result.sessionToken, result.csrfToken, result.maxAgeSeconds);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, user: result.user, csrfToken: result.csrfToken });
  };

  public logout = (req: Request, res: Response) => {
    if (req.authSessionToken && req.authUser) this.auth.logout(req.authSessionToken, req.authUser.id);
    clearAuthCookies(res);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true });
  };

  public me = (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: req.authUser });
  };
}
