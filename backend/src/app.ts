import express from 'express';
import cors from 'cors';
import path from 'path';
import { DatabaseRepository } from './repositories/DatabaseRepository';
import { DashboardService } from './services/DashboardService';
import { DashboardController } from './controllers/DashboardController';
import { createApiRouter } from './routes/apiRoutes';

export function createApp(dbPath: string, uploadDir: string) {
  const app = express();

  // Middleware
  app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  
  // Increase payload limit for base64 image uploads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Serve uploads static assets
  app.use('/uploads', express.static(uploadDir));

  // Initialize DB, Service, Controller
  const repo = new DatabaseRepository(dbPath);
  const service = new DashboardService(repo, uploadDir);
  const controller = new DashboardController(repo, service);

  // Health endpoint
  app.get('/healthz', (req, res) => {
    res.json({ ok: true });
  });

  // Mount API router
  app.use('/api', createApiRouter(controller));

  // Fallback handler
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Endpoint not found' });
  });

  return app;
}
