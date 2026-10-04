import React, { useEffect, useState } from 'react';

type Stage = { stage: string; samples: number; avgMs: number; p95Ms: number; errors: number };
type Endpoint = { endpoint: string; requests: number; avgMs: number; p95Ms: number; errorRate: number };
type Metrics = { performance: { sampleSize: number; endpoints: Endpoint[] }; stages: { stages: Stage[] } };
const LABELS: Record<string, string> = {
  upload_quality_processing: '上傳解碼與品質檢查', ai_guidance: '拍攝導引 AI', ai_damage: '車損 AI',
  incident_creation: 'Incident 建立', submission_db_write: 'Submission 資料庫寫入', submission_processing: 'Submission 處理總計',
  line_queue_wait: 'LINE 排隊等待', line_api: 'LINE API', submission_to_line_accepted: 'Submission → LINE API 接受'
};

const LatencyPanel: React.FC = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch('/api/performance', { credentials: 'include', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('無法載入耗時紀錄');
        setMetrics(await response.json()); setError('');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '無法載入耗時紀錄');
      } finally { inFlight = false; }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, []);
  return <section className="surface-card latency-panel" aria-label="API 與處理階段耗時">
    <header><span className="eyebrow">LATENCY</span><h2>處理耗時</h2></header>
    <p>最近 {metrics?.performance.sampleSize || 0} 次 API 請求 · 每 15 秒更新 · 單位 ms</p>
    {error && <p role="alert">{error}</p>}
    <div className="latency-table-wrap"><table><caption>分階段耗時（最近 500 筆紀錄）</caption><thead><tr><th>階段</th><th>筆數</th><th>平均</th><th>P95</th><th>錯誤</th></tr></thead><tbody>
      {metrics?.stages.stages.map(stage => <tr key={stage.stage}><td>{LABELS[stage.stage] || stage.stage}</td><td>{stage.samples}</td><td>{stage.avgMs}</td><td>{stage.p95Ms}</td><td>{stage.errors}</td></tr>)}
      {!metrics?.stages.stages.length && <tr><td colSpan={5}>尚無處理階段紀錄。提交驗車照片後會顯示。</td></tr>}
    </tbody></table></div>
    <p>「LINE API 接受」是平台接受推播的時間；各階段可能包含彼此，不能直接相加。</p>
    <details><summary>查看各端點耗時</summary><div className="latency-table-wrap"><table><thead><tr><th>端點</th><th>筆數</th><th>平均</th><th>P95</th><th>錯誤率</th></tr></thead><tbody>
      {metrics?.performance.endpoints.map(endpoint => <tr key={endpoint.endpoint}><td>{endpoint.endpoint}</td><td>{endpoint.requests}</td><td>{endpoint.avgMs}</td><td>{endpoint.p95Ms}</td><td>{endpoint.errorRate}%</td></tr>)}
    </tbody></table></div></details>
  </section>;
};
export default LatencyPanel;
