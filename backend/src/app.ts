import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { DatabaseRepository } from './repositories/DatabaseRepository';
import { DashboardService } from './services/DashboardService';
import { DashboardController } from './controllers/DashboardController';
import { createApiRouter } from './routes/apiRoutes';
import { PerformanceMonitor } from './services/PerformanceMonitor';
import { StageMetrics } from './services/StageMetrics';
import { AuthService } from './auth/AuthService';
import { AuthController } from './auth/AuthController';
import { attachAuthentication, configuredOrigins, loginRequired, roleRequired } from './auth/middleware';

export function createApp(dbPath: string, uploadDir: string) {
  const app = express();
  const repo = new DatabaseRepository(dbPath);
  const service = new DashboardService(repo, uploadDir);
  const controller = new DashboardController(repo, service, uploadDir);
  const authController = new AuthController(new AuthService(repo));
  const performanceMonitor = new PerformanceMonitor();
  app.locals.databaseRepository = repo;
  service.startOperationsWorker();
  app.locals.stopWorkers = () => service.close();

  // Middleware
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || configuredOrigins().includes(origin.replace(/\/$/, ''))) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key']
  }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Permissions-Policy', 'camera=(self)');
    res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    next();
  });

  // Do not spend CPU recompressing already-compressed uploads. JSON API responses over 1 KB
  // are compressed by the backend even when the hosting proxy does not guarantee compression.
  app.use(compression({
    threshold: 1024,
    filter: (req, res) => !req.path.startsWith('/uploads/') && compression.filter(req, res)
  }));

  app.use(performanceMonitor.middleware);

  // LINE requires the exact bytes to verify x-line-signature. It must run before express.json().
  app.post('/api/line/webhook', express.raw({ type: 'application/json', limit: '2mb' }), controller.receiveLineWebhook);
  
  // Increase payload limit for base64 image uploads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // LINE fetches signed, short-lived image URLs without a browser session.
  app.get('/api/line-images/:photoId', controller.getSignedLineDamagePhoto);

  app.use(attachAuthentication(repo));

  // Health endpoint
  app.get('/healthz', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/performance', loginRequired, roleRequired('admin'), (req, res) => {
    res.json({ ok: true, performance: performanceMonitor.snapshot(), stages: new StageMetrics(repo).snapshot(), notifications: service.getNotificationStats() });
  });

  // Mount API router
  app.get('/uploads/:filename', loginRequired, controller.getUpload);

  app.use('/api', createApiRouter(controller, authController));

  const frontendDist = process.env.FRONTEND_DIST || path.resolve(__dirname, '../../frontend/dist');
  const frontendIndex = path.join(frontendDist, 'index.html');
  const serveFrontend = process.env.NODE_ENV === 'production'
    || /^(1|true|yes|on)$/i.test(String(process.env.SERVE_FRONTEND || ''));

  if (serveFrontend && fs.existsSync(frontendIndex)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => {
      res.sendFile(frontendIndex);
    });
  }

  // Fallback handler for API/local backend-only requests
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Endpoint not found' });
  });

  return app;
}
