import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';

export function createApiRouter(controller: DashboardController): Router {
  const router = Router();

  router.get('/state', controller.getProjectState);
  router.get('/submissions', controller.getPhotoSubmissions);
  router.get('/submissions/:submissionId', controller.getPhotoSubmissionDetail);
  
  router.post('/incidents', controller.insertIncident);
  router.post('/action', controller.handleAction);
  router.post('/photos/quality-check', controller.runQualityCheck);
  router.post('/photo-submissions', controller.handlePhotoSubmission);
  router.post('/settings/slack', controller.updateSlackSettings);

  return router;
}
