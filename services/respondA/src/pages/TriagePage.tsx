import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts';
import { usePresence } from '../hooks/usePresence';
import { Header } from '../components/layout/Header';
import { TriageQueue } from '../components/triage/TriageQueue';
import { ActionCanvas } from '../components/canvas/ActionCanvas';
import type { Alert, AlertResolution, AlertImpact } from '../types';

export const TriagePage = () => {
    const navigate = useNavigate();
    const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
    const { alerts, loading } = useAlerts();
    const { presences } = usePresence(selectedAlert?.id || 'triage-queue');

    const handleAlertClick = (alert: Alert) => {
        setSelectedAlert(alert);
    };

    const handleEscalate = (alertId: string) => {
        console.log('Escalating alert:', alertId);
        // In a real app, this would create an incident in Firestore and then navigate
        navigate(`/incident/${alertId}-incident`);
    };

    const handleResolve = (alertId: string, resolution: AlertResolution, impact: AlertImpact) => {
        console.log('Resolving alert:', alertId, resolution, impact);
        setSelectedAlert(null);
    };

    const handleAction = (alertId: string, type: 'parry' | 'riposte', action: string) => {
        console.log(`Executing ${type}: ${action} on alert ${alertId}`);
    };

    return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
            <Header presences={presences.filter(p => p.activeContextId === 'triage-queue')} />

            <main className="flex-1 flex flex-col overflow-hidden">
                <div className="h-12 border-b border-border bg-surface px-6 flex items-center justify-between shrink-0">
                    <h1 className="font-heading font-bold text-sm uppercase tracking-widest text-muted">Triage Queue</h1>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-muted uppercase">
                        <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                        Live Sync Active
                    </div>
                </div>

                <TriageQueue
                    alerts={alerts}
                    presences={presences}
                    onAlertClick={handleAlertClick}
                    loading={loading}
                />
            </main>

            <ActionCanvas
                alert={selectedAlert}
                onClose={() => setSelectedAlert(null)}
                onEscalate={handleEscalate}
                onResolve={handleResolve}
                onAction={handleAction}
            />
        </div>
    );
};
