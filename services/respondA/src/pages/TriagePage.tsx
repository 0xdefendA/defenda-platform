import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts';
import { usePresence } from '../hooks/usePresence';
import { Sidebar } from '../components/layout/Sidebar';
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
        <div className="flex h-screen bg-background-light dark:bg-background-dark text-text-main overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <Header presences={presences.filter(p => p.activeContextId === 'triage-queue')} />

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
