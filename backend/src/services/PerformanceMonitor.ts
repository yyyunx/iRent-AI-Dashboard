import { Request, Response, NextFunction } from 'express';

type Sample = { method: string; path: string; status: number; durationMs: number; at: number };

/** Keep real API names intact; only opaque database IDs are collapsed for aggregation. */
export function normalizedPath(path: string): string {
  return path
    .replace(/^\/uploads\/[^/]+$/, '/uploads/:filename')
    .replace(/(\/agent\/action-drafts)\/[^/]+(?=\/|$)/, '$1/:draftId')
    .replace(/\/(?:SUB|INC|PHOTO)(?:-AI)?-[A-Za-z0-9_-]{16}(?=\/|$)/g, '/:id');
}

export class PerformanceMonitor {
  private readonly samples: Sample[] = [];
  private readonly startedAt = Date.now();
  private readonly limit = 200;

  public middleware = (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api') && req.path !== '/healthz' && !req.path.startsWith('/uploads/')) return next();
    // Capture before Express mounts the router and temporarily changes req.path.
    const path = normalizedPath(req.path);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.samples.push({ method: req.method, path, status: res.statusCode, durationMs, at: Date.now() });
      if (this.samples.length > this.limit) this.samples.shift();
    });
    next();
  };

  public snapshot() {
    const byEndpoint = new Map<string, Sample[]>();
    for (const sample of this.samples) {
      const key = `${sample.method} ${sample.path}`;
      const list = byEndpoint.get(key) || [];
      list.push(sample);
      byEndpoint.set(key, list);
    }
    const endpoints = [...byEndpoint.entries()].map(([key, samples]) => {
      const timings = samples.map(s => s.durationMs).sort((a, b) => a - b);
      const percentile = (p: number) => timings[Math.min(timings.length - 1, Math.ceil(timings.length * p) - 1)] || 0;
      return {
        method: samples[0].method,
        path: samples[0].path,
        endpoint: key,
        requests: samples.length,
        avgMs: Math.round((timings.reduce((sum, ms) => sum + ms, 0) / timings.length) * 10) / 10,
        p50Ms: Math.round(percentile(0.5) * 10) / 10,
        p95Ms: Math.round(percentile(0.95) * 10) / 10,
        p99Ms: Math.round(percentile(0.99) * 10) / 10,
        maxMs: Math.round(timings[timings.length - 1] * 10) / 10,
        errorRate: Math.round((samples.filter(s => s.status >= 400).length / samples.length) * 1000) / 10
      };
    }).sort((a, b) => b.p95Ms - a.p95Ms);
    return { uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000), sampleSize: this.samples.length, endpoints };
  }
}
