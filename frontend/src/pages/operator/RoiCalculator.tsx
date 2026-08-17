import React, { useMemo, useState } from 'react';
import { Calculator, CircleDollarSign, Clock3, TrendingUp } from 'lucide-react';

type Inputs = {
  monthlyChecks: number;
  minutesSaved: number;
  hourlyCost: number;
  preventionRate: number;
  averageLoss: number;
  monthlyPlatformCost: number;
  oneTimeSetupCost: number;
};

const initial: Inputs = { monthlyChecks: 2400, minutesSaved: 8, hourlyCost: 280, preventionRate: 3, averageLoss: 4500, monthlyPlatformCost: 18000, oneTimeSetupCost: 120000 };
const money = new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 });

const RoiCalculator: React.FC = () => {
  const [inputs, setInputs] = useState<Inputs>(initial);
  const result = useMemo(() => {
    const labor = inputs.monthlyChecks * inputs.minutesSaved / 60 * inputs.hourlyCost;
    const prevented = inputs.monthlyChecks * inputs.preventionRate / 100 * inputs.averageLoss;
    const benefit = labor + prevented;
    const net = benefit - inputs.monthlyPlatformCost;
    const roi = inputs.monthlyPlatformCost > 0 ? net / inputs.monthlyPlatformCost * 100 : 0;
    const paybackMonths = net > 0 ? inputs.oneTimeSetupCost / net : null;
    return { labor, prevented, benefit, net, roi, paybackMonths };
  }, [inputs]);

  const update = (key: keyof Inputs, value: string) => setInputs(current => ({ ...current, [key]: Math.max(0, Number(value) || 0) }));
  const fields: { key: keyof Inputs; label: string; hint: string; suffix: string }[] = [
    { key: 'monthlyChecks', label: '每月驗車／案件量', hint: '預計由 AI 協助處理的檢查次數', suffix: '次' },
    { key: 'minutesSaved', label: '每次節省工時', hint: 'AI 篩檢與自動派工節省的人工分鐘', suffix: '分鐘' },
    { key: 'hourlyCost', label: '人力完全成本', hint: '包含薪資、管理與相關成本', suffix: '元／小時' },
    { key: 'preventionRate', label: '預防損失比例', hint: '及早發現問題而避免的比例', suffix: '%' },
    { key: 'averageLoss', label: '平均可避免損失', hint: '每件漏損、延誤或清潔問題的平均成本', suffix: '元' },
    { key: 'monthlyPlatformCost', label: '每月平台成本', hint: '含雲端、模型與維運成本', suffix: '元／月' },
    { key: 'oneTimeSetupCost', label: '一次性導入成本', hint: '串接、教育訓練與初期導入成本', suffix: '元' }
  ];

  return <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] gap-5 items-start">
    <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-irent-line"><h2 className="text-lg font-black text-irent-ink flex gap-2 items-center"><Calculator size={20} className="text-irent-red" /> ROI 試算參數</h2><button onClick={() => setInputs(initial)} className="text-xs font-bold text-irent-red hover:underline">還原範例數值</button></div>
      <p className="text-sm text-irent-muted m-0 leading-relaxed">以人力節省＋可避免損失估算。這是營運決策試算，請用實際歷史資料更新假設值。</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{fields.map(field => <label key={field.key} className="flex flex-col gap-1.5"><span className="text-sm font-bold text-irent-ink">{field.label}</span><span className="text-xs text-irent-muted min-h-[30px]">{field.hint}</span><div className="flex items-center border border-irent-line rounded-xl overflow-hidden focus-within:border-irent-red"><input aria-label={field.label} type="number" min="0" value={inputs[field.key]} onChange={event => update(field.key, event.target.value)} className="h-11 min-w-0 flex-1 px-3 outline-none" /><span className="px-3 text-xs font-bold text-irent-muted bg-slate-50 self-stretch flex items-center whitespace-nowrap">{field.suffix}</span></div></label>)}</div>
    </section>
    <section className="bg-white border border-irent-line rounded-2xl shadow-premium p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-irent-line"><h2 className="text-lg font-black text-irent-ink flex gap-2 items-center"><TrendingUp size={20} className="text-[#06a853]" /> 預估效益</h2><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${result.net > 0 ? 'bg-[#e9f9ef] text-[#067b37]' : 'bg-amber-50 text-amber-800'}`}>{result.net > 0 ? '正向回報' : '需調整假設'}</span></div>
      <Metric icon={<Clock3 size={18} />} label="每月人力節省" value={money.format(result.labor)} />
      <Metric icon={<CircleDollarSign size={18} />} label="每月避免損失" value={money.format(result.prevented)} />
      <Metric icon={<TrendingUp size={18} />} label="每月總效益" value={money.format(result.benefit)} emphasis />
      <div className="border-t border-irent-line pt-4 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs text-irent-muted block">每月淨效益</span><strong className={`text-xl font-black ${result.net >= 0 ? 'text-[#067b37]' : 'text-irent-red'}`}>{money.format(result.net)}</strong></div><div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs text-irent-muted block">月 ROI</span><strong className={`text-xl font-black ${result.roi >= 0 ? 'text-[#067b37]' : 'text-irent-red'}`}>{result.roi.toFixed(0)}%</strong></div></div>
      <div className="rounded-2xl border border-irent-line p-4 text-sm"><strong className="block text-irent-ink">回本期間</strong><span className="text-irent-muted">{result.paybackMonths === null ? '目前每月淨效益未為正，無法估算回本。' : `${result.paybackMonths.toFixed(1)} 個月（一次性導入成本 ÷ 每月淨效益）`}</span></div>
      <p className="text-[11px] text-irent-muted leading-relaxed m-0">公式：每月人力節省 = 案件量 × 節省分鐘 ÷ 60 × 人力成本；避免損失 = 案件量 × 預防損失比例 × 平均損失。月 ROI =（總效益 − 月平台成本）÷ 月平台成本。</p>
    </section>
  </div>;
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: string; emphasis?: boolean }> = ({ icon, label, value, emphasis }) => <div className={`rounded-2xl p-4 flex items-center gap-3 ${emphasis ? 'bg-[#e9f9ef]' : 'bg-slate-50'}`}><span className={emphasis ? 'text-[#067b37]' : 'text-irent-muted'}>{icon}</span><span className="min-w-0 flex-1"><span className="block text-xs text-irent-muted">{label}</span><strong className={`block text-lg font-black ${emphasis ? 'text-[#067b37]' : 'text-irent-ink'}`}>{value}</strong></span></div>;

export default RoiCalculator;
