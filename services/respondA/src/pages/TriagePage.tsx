import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useAlerts } from '../hooks/useAlerts';
import { usePresence } from '../hooks/usePresence';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { TriageQueue } from '../components/triage/TriageQueue';
import { ActionCanvas } from '../components/canvas/ActionCanvas';
import type { Alert, AlertResolution, AlertImpact } from '../types';

export const TriagePage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('OPEN');
    const [severityFilter, setSeverityFilter] = useState<string[]>([]);
    const [queueFilter, setQueueFilter] = useState<'all' | 'my' | 'escalated'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const { alerts, loading } = useAlerts(statusFilter);
    const { presences } = usePresence(selectedAlert?.id || 'triage-queue');

    const filteredAlerts = alerts.filter(a => {
        const matchesSeverity = severityFilter.length === 0 || severityFilter.includes(a.severity.toLowerCase());
        const matchesQueue = queueFilter === 'all' ||
            (queueFilter === 'my' && a.assigneeId === user?.uid) ||
            (queueFilter === 'escalated' && a.status === 'ESCALATED');

        const search = searchTerm.toLowerCase();
        const matchesSearch = !searchTerm ||
            a.alert_name.toLowerCase().includes(search) ||
            a.id.toLowerCase().includes(search) ||
            a.summary.toLowerCase().includes(search);

        return matchesSeverity && matchesQueue && matchesSearch;
    });

    const counts = {
        total: alerts.length,
        myQueue: alerts.filter(a => a.assigneeId === user?.uid).length,
        escalated: alerts.filter(a => a.status === 'ESCALATED').length,
        critical: alerts.filter(a => a.severity.toLowerCase() === 'critical').length,
        high: alerts.filter(a => a.severity.toLowerCase() === 'high').length,
        medium: alerts.filter(a => a.severity.toLowerCase() === 'medium').length,
        low: alerts.filter(a => a.severity.toLowerCase() === 'low').length,
        info: alerts.filter(a => a.severity.toLowerCase() === 'info').length,
    };

    const handleAlertClick = (alert: Alert) => {
        setSelectedAlert(alert);
    };

    const handleEscalate = (alertId: string) => {
        console.log('Escalating alert:', alertId);
        // In a real app, this would create an incident in Firestore and then navigate
        navigate(`/incident/${alertId}-incident`);
    };

    const handleResolve = async (alertId: string, resolution: AlertResolution, impact: AlertImpact) => {
        console.log('Resolving alert:', alertId, resolution, impact);
        try {
            const alertRef = doc(db, 'alerts', alertId);
            await updateDoc(alertRef, {
                status: 'RESOLVED',
                resolution,
                impact,
                resolved_at: new Date()
            });
            setSelectedAlert(null);
        } catch (err) {
            console.error('Error resolving alert:', err);
            alert('Failed to resolve alert. See console for details.');
        }
    };

    const handleAction = (alertId: string, type: 'parry' | 'riposte', action: string) => {
        console.log(`Executing ${type}: ${action} on alert ${alertId}`);
    };

    const handleClaim = async (alertId: string) => {
        if (!user) return;
        try {
            const alertRef = doc(db, 'alerts', alertId);
            await updateDoc(alertRef, {
                assigneeId: user.uid,
                assigneeName: user.displayName || user.email?.split('@')[0] || 'Analyst'
            });
        } catch (err) {
            console.error('Error claiming alert:', err);
        }
    };

    const handleUnclaim = async (alertId: string) => {
        try {
            const alertRef = doc(db, 'alerts', alertId);
            await updateDoc(alertRef, {
                assigneeId: null,
                assigneeName: null
            });
        } catch (err) {
            console.error('Error unclaiming alert:', err);
        }
    };

    return (
        <div className="flex h-screen bg-background-light dark:bg-background-dark text-text-main overflow-hidden">
            <Sidebar
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                severityFilter={severityFilter}
                onSeverityFilterChange={setSeverityFilter}
                queueFilter={queueFilter}
                onQueueFilterChange={setQueueFilter}
                counts={counts}
            />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <Header
                    presences={presences.filter(p => p.activeContextId === 'triage-queue')}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                />

                <TriageQueue
                    alerts={filteredAlerts}
                    presences={presences}
                    onAlertClick={handleAlertClick}
                    onClaim={handleClaim}
                    onUnclaim={handleUnclaim}
                    currentUserId={user?.uid}
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
