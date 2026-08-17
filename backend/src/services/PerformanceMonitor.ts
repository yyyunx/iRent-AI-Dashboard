import { Request, Response, NextFunction } from 'express';

type Sample = { path: string; status: number; durationMs: number; at: number };

export class PerformanceMonitor {
  private readonly samples: Sample[] = [];
  private readonly startedAt = Date.now();
  private readonly limit = 200;

  public middleware = (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) return next();
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.samples.push({ path: req.path, status: res.statusCode, durationMs, at: Date.now() });
      if (this.samples.length > this.limit) this.samples.shift();
    });
    next();
  };

  public snapshot() {
    const byEndpoint = new Map<string, Sample[]>();
    for (const sample of this.samples) {
      const list = byEndpoint.get(sample.path) || [];
      list.push(sample);
      byEndpoint.set(sample.path, list);
    }
    const endpoints = [...byEndpoint.entries()].map(([path, samples]) => {
      const timings = samples.map(s => s.durationMs).sort((a, b) => a - b);
      const percentile = (p: number) => timings[Math.min(timings.length - 1, Math.ceil(timings.length * p) - 1)] || 0;
      return {
        path,
        requests: samples.length,
        avgMs: Math.round((timings.reduce((sum, ms) => sum + ms, 0) / timings.length) * 10) / 10,
        p50Ms: Math.round(percentile(0.5) * 10) / 10,
        p95Ms: Math.round(percentile(0.95) * 10) / 10,
        errorRate: Math.round((samples.filter(s => s.status >= 400).length / samples.length) * 1000) / 10
      };
    }).sort((a, b) => b.p95Ms - a.p95Ms);
    return { uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000), sampleSize: this.samples.length, endpoints };
  }
}
