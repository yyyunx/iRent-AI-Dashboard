import { DatabaseRepository } from '../repositories/DatabaseRepository';

export class StageMetrics {
  constructor(private repo: DatabaseRepository) {}
  public async measure<T>(stage: string, traceId: string | null, operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const started = process.hrtime.bigint();
    try {
      const result = await operation();
      this.repo.recordStageMetric(stage, traceId, startedAt, Number(process.hrtime.bigint() - started) / 1e6);
      return result;
    } catch (error) {
      this.repo.recordStageMetric(stage, traceId, startedAt, Number(process.hrtime.bigint() - started) / 1e6, 'error');
      throw error;
    }
  }
  public snapshot() {
    const recent = this.repo.getStageMetrics();
    const groups = new Map<string, any[]>();
    for (const sample of recent) groups.set(sample.stage, [...(groups.get(sample.stage) || []), sample]);
    const stages = [...groups].map(([stage, samples]) => {
      const values = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
      const round = (value: number) => Math.round(value * 10) / 10;
      return { stage, samples: values.length, avgMs: round(values.reduce((a, b) => a + b) / values.length), p95Ms: round(values[Math.ceil(values.length * 0.95) - 1]), errors: samples.filter(sample => sample.outcome === 'error').length };
    });
    return { stages, recent: recent.slice(0, 30) };
  }
}
