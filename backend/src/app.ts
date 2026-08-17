import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { DatabaseRepository } from './repositories/DatabaseRepository';
import { DashboardService } from './services/DashboardService';
import { DashboardController } from './controllers/DashboardController';
import { createApiRouter } from './routes/apiRoutes';
import { PerformanceMonitor } from './services/PerformanceMonitor';

export function createApp(dbPath: string, uploadDir: string) {
  const app = express();
  const repo = new DatabaseRepository(dbPath);
  const service = new DashboardService(repo, uploadDir);
  const controller = new DashboardController(repo, service);
  const performanceMonitor = new PerformanceMonitor();

  // Middleware
  app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  // LINE requires the exact bytes to verify x-line-signature. It must run before express.json().
  app.post('/api/line/webhook', express.raw({ type: 'application/json', limit: '2mb' }), controller.receiveLineWebhook);
  app.use(performanceMonitor.middleware);
  
  // Increase payload limit for base64 image uploads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Serve uploads static assets
  app.use('/uploads', express.static(uploadDir));

  // Health endpoint
  app.get('/healthz', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/performance', (req, res) => {
    res.json({ ok: true, performance: performanceMonitor.snapshot(), notifications: service.getNotificationStats() });
  });

  // Mount API router
  app.use('/api', createApiRouter(controller));

  const frontendDist = process.env.FRONTEND_DIST || path.resolve(__dirname, '../../frontend/dist');
  const frontendIndex = path.join(frontendDist, 'index.html');

  if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendIndex)) {
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
