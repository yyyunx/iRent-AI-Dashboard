import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { AuthController } from '../auth/AuthController';
import { csrfProtection, loginRequired, roleRequired } from '../auth/middleware';

export function createApiRouter(controller: DashboardController, authController: AuthController): Router {
  const router = Router();

  router.get('/auth/csrf', authController.csrf);
  router.post('/auth/login', authController.rateLimiter.middleware, csrfProtection, authController.login);
  router.get('/auth/me', loginRequired, authController.me);
  router.post('/auth/logout', loginRequired, csrfProtection, authController.logout);

  router.use(loginRequired);

  router.get('/state', controller.getProjectState);
  router.get('/submissions', controller.getPhotoSubmissions);
  router.get('/submissions/:submissionId', controller.getPhotoSubmissionDetail);

  router.post('/photos/quality-check', csrfProtection, controller.runQualityCheck);
  router.post('/photo-submissions', csrfProtection, controller.handlePhotoSubmission);

  router.post('/incidents', roleRequired('admin'), csrfProtection, controller.insertIncident);
  router.post('/action', roleRequired('admin'), csrfProtection, controller.handleAction);
  router.post('/settings/line', roleRequired('admin'), csrfProtection, controller.updateLineSettings);
  router.post('/settings/ai', roleRequired('admin'), csrfProtection, controller.updateAiSettings);
  router.post('/agent/query', roleRequired('admin'), csrfProtection, controller.runAiAgent);
  router.get('/agent/operations', roleRequired('admin'), controller.getAgentOperations);
  router.get('/agent/history', roleRequired('admin'), controller.getAgentTaskHistory);
  router.post('/agent/dispatch-drafts', roleRequired('admin'), csrfProtection, controller.createDispatchDraft);
  router.post('/agent/line-drafts', roleRequired('admin'), csrfProtection, controller.createLineDraft);
  router.post('/agent/action-drafts/:draftId/confirm', roleRequired('admin'), csrfProtection, controller.confirmAgentActionDraft);
  router.post('/notifications/line/test', roleRequired('admin'), csrfProtection, controller.sendLineTest);

  return router;
}
