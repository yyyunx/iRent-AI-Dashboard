import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Bot, Sparkles, Send, Cpu, RefreshCw, HelpCircle } from 'lucide-react';

const Analytics: React.FC = () => {
  const { state, showToast } = useApp();
  const [promptInput, setPromptInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [agentExecuting, setAgentExecuting] = useState(false);

  const damageHotspots = state?.damageHotspots || [];
  const incidents = state?.incidents || [];
  const maxHotspotCount = damageHotspots.length > 0 ? Math.max(...damageHotspots.map(row => row[1])) : 1;

  // Calculate fleet health scores
  const fleetHealths = incidents.slice(0, 5).map(item => {
    const clean = item.type === "cleaning" ? 62 : 92;
    const damage = item.type === "damage" ? 58 : 90;
    const usage = item.nextBooking < 40 ? 72 : 84;
    const score = Math.round(clean * 0.4 + damage * 0.4 + usage * 0.2);
    return {
      plate: item.plate,
      station: item.station,
      label: item.label,
      health: score
    };
  }).sort((a, b) => a.health - b.health);

  const presets = [
    '分析近30天車損熱區與預防保養建議',
    '針對 Fleet Health 低於 70% 的車輛規劃自動派工',
    '預測下周高峰時段熱門站點調度需求',
    '生成 AI Agent 車隊維護效率與時間節省報告'
  ];

  const handleRunAiAnalysis = (query: string) => {
    const q = query.trim();
    if (!q) return;
    setPromptInput(q);
    setAnalyzing(true);
    setAiReport(null);

    setTimeout(() => {
      setAnalyzing(false);
      if (q.includes('熱區') || q.includes('車損')) {
        setAiReport(`🤖 AI Agent 分析報告：
• 車損最高熱區為 ${damageHotspots[0]?.[0] || '前保桿/水箱護罩'}（近30天計 ${damageHotspots[0]?.[1] || 12} 次）。
• 建議行動：優先針對該熱區配置強化防護套件，並對重複受損車輛自動排入 S 級保養。
• 預期效益：估計可再減少 28% 人工審核時間並提升車輛運轉率 15%。`);
      } else if (q.includes('Health') || q.includes('低於') || q.includes('派工')) {
        const lowHealthPlates = fleetHealths.filter(f => f.health < 80).map(f => f.plate).join('、') || '無低健康度車輛';
        setAiReport(`🤖 AI Agent 診斷與調度方案：
• 低健康度車輛關注標的：${lowHealthPlates}。
• AI 診斷：清潔度與連續租借係數下降，建議安排今晚非高峰時段進站檢保。
• 自動化動作：已為上述車輛預先生成「AI 智慧派工單」，待確認後直接推播給巡檢小隊 LINE 群組。`);
      } else if (q.includes('預測') || q.includes('站點') || q.includes('高峰')) {
        setAiReport(`🤖 AI Agent 流量與調度預測：
• 預測週五 17:00-21:00 台北市中心站點需求將激增 35%。
• 建議調度：將周邊備用正常車輛（高健康度）預先調度至核心站點。
• 系統運作：AI Agent 已設定自動即時排程，當庫存低於 2 台時自動觸發 LINE 推播警示。`);
      } else {
        setAiReport(`🤖 AI Agent 營運綜合診斷報告：
• 目前車隊整體健康分數穩定（平均 84 分）。
• AI 自動結案率為 ${state?.opsMetrics?.autoCloseRate || '78%'}，平均處理時間節省 ${state?.opsMetrics?.avgTimeSaved || '18分'}。
• 建議持續保持目前自動派工與完工 AI Review 流程，系統整體運轉效率優良。`);
      }
    }, 600);
  };

  const handleExecuteAgentTask = () => {
    setAgentExecuting(true);
    setTimeout(() => {
      setAgentExecuting(false);
      showToast('AI Agent 執行成功', '已自動根據營運分析數據生成 3 筆預防性維修任務，並同步 LINE Bot。');
    }, 800);
  };

  return (
    <div className="flex flex-col gap-5 min-w-0">
      {/* AI Agent Banner Section */}
      <section className="bg-gradient-to-r from-[#111827] via-[#1f2937] to-[#111827] text-white border border-gray-700 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-irent-red/20 border border-irent-red/40 flex items-center justify-center text-irent-red shadow-inner">
              <Bot size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black m-0 tracking-tight">iRent AI Operations Copilot Agent</h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Agent 運作中
                </span>
              </div>
              <p className="text-xs text-gray-400 m-0 mt-0.5">即時分析車隊數據 · 自動化預防診斷 · 智慧派工與趨勢預測</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleExecuteAgentTask}
            disabled={agentExecuting}
            className="self-start sm:self-auto min-h-[38px] px-4 rounded-xl bg-irent-red hover:bg-[#cc0010] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-lg active:scale-95 disabled:opacity-50"
          >
            {agentExecuting ? <RefreshCw size={14} className="animate-spin" /> : <Cpu size={15} />}
            {agentExecuting ? 'AI Agent 執行中…' : '執行 AI 自動預防性派工'}
          </button>
        </div>

        {/* AI Agent Interactive Query Box */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
            <Sparkles size={14} className="text-amber-400" />
            詢問 AI Copilot Agent 分析營運問題：
          </label>

          <div className="flex flex-wrap gap-2">
            {presets.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleRunAiAnalysis(preset)}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-all font-medium text-left"
              >
                💡 {preset}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={promptInput}
              onChange={e => setPromptInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRunAiAnalysis(promptInput)}
              placeholder="例如：分析 101 站點車損熱區，或輸入任何營運查詢…"
              className="flex-1 bg-gray-900/90 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-irent-red transition-all"
            />
            <button
              type="button"
              onClick={() => handleRunAiAnalysis(promptInput)}
              disabled={analyzing || !promptInput.trim()}
              className="px-4 py-2 rounded-xl bg-irent-red text-white text-xs font-bold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40 transition-all"
            >
              <Send size={14} />
              {analyzing ? '分析中…' : '諮詢 Agent'}
            </button>
          </div>

          {/* AI Report Card */}
          {aiReport && (
            <div className="mt-2 p-4 rounded-xl bg-gray-900/95 border border-irent-red/40 text-xs leading-relaxed text-gray-200 font-sans shadow-inner whitespace-pre-line animate-fadeIn">
              {aiReport}
            </div>
          )}
        </div>
      </section>

      {/* Main Analytics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-4 lg:gap-5 items-start min-w-0">
        {/* Damage Hotspots */}
        <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-4 sm:p-5 flex flex-col gap-4 min-w-0">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pb-3 border-b border-irent-line">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-irent-ink m-0">近 30 天車損熱區</h2>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                <Sparkles size={11} /> AI 自動追蹤
              </span>
            </div>
            <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">維修預測</span>
          </div>

          <div className="flex flex-col gap-3.5 py-2">
            {damageHotspots.length > 0 ? (
              damageHotspots.map(([label, count]) => (
                <div key={label} className="grid grid-cols-[minmax(0,1fr)_44px] sm:grid-cols-[minmax(110px,140px)_minmax(0,1fr)_44px] gap-2 sm:gap-3 items-center text-sm">
                  <strong className="text-irent-ink font-extrabold break-anywhere">{label}</strong>
                  <div className="col-span-2 sm:col-span-1 sm:col-start-2 h-5 rounded-full bg-[#edf1f5] overflow-hidden">
                    <div 
                      className="h-full rounded-full bg-irent-red"
                      style={{ width: `${(count / maxHotspotCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-irent-muted font-bold text-right">{count}次</span>
                </div>
              ))
            ) : (
              <p className="text-irent-muted text-xs text-center py-10">尚無車損統計</p>
            )}
          </div>
        </section>

        {/* Fleet Health Status */}
        <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-4 sm:p-5 flex flex-col gap-4 min-w-0">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pb-3 border-b border-irent-line">
            <h2 className="text-lg font-black text-irent-ink m-0">Fleet Health</h2>
            <span className="text-xs font-bold text-irent-red bg-irent-soft-red px-2.5 py-1 rounded-full">
              乾淨度 40% + 車損 40% + 租借 20%
            </span>
          </div>

          <div className="flex flex-col gap-3 max-h-[560px] overflow-y-auto">
            {fleetHealths.length > 0 ? (
              fleetHealths.map((item, index) => (
                <article key={index} className="border border-irent-line rounded-2xl p-3.5 flex flex-col gap-2 bg-white">
                  <div className="flex justify-between items-center gap-2 text-sm">
                    <strong className="text-[#222222] font-black">{item.plate}</strong>
                    <span className="text-irent-ink font-bold">{item.health}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-[#edf1f5] overflow-hidden">
                    <div 
                      className="h-full bg-irent-red"
                      style={{ width: `${item.health}%` }}
                    />
                  </div>
                  <span className="text-irent-muted text-xs block break-anywhere">
                    {item.station} · {item.label}
                  </span>
                </article>
              ))
            ) : (
              <div className="text-center py-20 text-irent-muted flex flex-col items-center justify-center gap-2">
                <HelpCircle size={40} className="text-irent-line" />
                無車輛健康度資訊
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Analytics;
