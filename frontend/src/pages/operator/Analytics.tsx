import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import AgentHero from '../../components/analytics/AgentHero';
import AgentInsightGrid from '../../components/analytics/AgentInsightGrid';
import DamageHotspotCard from '../../components/analytics/DamageHotspotCard';
import FleetHealthCard from '../../components/analytics/FleetHealthCard';
import AgentDispatchCard from '../../components/analytics/AgentDispatchCard';
import AgentOperationsPanel from '../../components/analytics/AgentOperationsPanel';
import PhotoComparisonCard from '../../components/analytics/PhotoComparisonCard';

const Analytics: React.FC = () => {
  const { state } = useApp();
  const navigate = useNavigate();
  const [command, setCommand] = useState<{ id: number; prompt: string } | null>(null);
  const openTasks = () => navigate('/operator/tasks');
  const runPrompt = (prompt: string) => {
    setCommand({ id: Date.now(), prompt });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="analytics-copilot-page">
      <AgentHero state={state} onOpenTasks={openTasks} requestedCommand={command} />
      <AgentInsightGrid state={state} onPrompt={runPrompt} onOpenTasks={openTasks} />
      <AgentOperationsPanel />
      <PhotoComparisonCard photos={state?.uploadedPhotos || []} />
      <section className="intelligence-grid" aria-label="AI Operations Intelligence">
        <DamageHotspotCard hotspots={state?.damageHotspots || []} />
        <FleetHealthCard incidents={state?.incidents || []} />
        <AgentDispatchCard incidents={state?.incidents || []} onOpenTasks={openTasks} />
      </section>
    </div>
  );
};

export default Analytics;
