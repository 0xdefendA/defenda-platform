import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useAlerts } from '../hooks/useAlerts';
import { usePresence } from '../hooks/usePresence';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { TriageQueue } from '../components/triage/TriageQueue';
import { FilterBar } from '../components/ui/FilterBar';
import { ActionCanvas } from '../components/canvas/ActionCanvas';
import type { Alert, AlertResolution, AlertImpact } from '../types';
import type { CriteriaRow, JsonPath } from '../lib/rules';
import {
    ALERT_DEFAULT_COLUMNS, TRIAGE_COLUMNS_KEY, columnForPath, loadColumns, saveColumns,
    type EventColumn,
} from '../lib/columns';
import { matchesAllRows } from '../lib/filter';

export const TriagePage = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('OPEN');
    const [severityFilter, setSeverityFilter] = useState<string[]>([]);
    const [queueFilter, setQueueFilter] = useState<'all' | 'my'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRows, setFilterRows] = useState<CriteriaRow[]>([]);
    const [columns, setColumns] = useState<EventColumn[]>(
        () => loadColumns(TRIAGE_COLUMNS_KEY, ALERT_DEFAULT_COLUMNS)
    );
    const { alerts, loading, hasMore, loadMore } = useAlerts(statusFilter);

    const updateColumns = (next: EventColumn[]) => {
        setColumns(next);
        saveColumns(TRIAGE_COLUMNS_KEY, next);
    };

    const handleAddColumn = (path: JsonPath, label?: string) => {
        const col = columnForPath(path, label);
        if (columns.some(c => c.id === col.id)) return;
        updateColumns([...columns, col]);
    };

    const handleRemoveColumn = (id: string) => {
        updateColumns(columns.filter(c => c.id !== id));
    };

    // Sync searchTerm with URL search param
    useEffect(() => {
        const query = searchParams.get('search');
        if (query) {
            setSearchTerm(query);
            // If we are searching for a specific alert, we might want to see it regardless of status
            if (query.length > 20) setStatusFilter('');
        }
    }, [searchParams]);
    const { presences } = usePresence(selectedAlert?.id || 'triage-queue');

    const filteredAlerts = alerts.filter(a => {
        const matchesSeverity = severityFilter.length === 0 || severityFilter.includes(a.severity.toLowerCase());
        const matchesQueue = queueFilter === 'all' || (queueFilter === 'my' && a.assigneeId === user?.uid);

        const search = searchTerm.toLowerCase();
        // Deep search: check displayed fields first, then all JSON data
        const matchesSearch = !searchTerm ||
            a.alert_name.toLowerCase().includes(search) ||
            a.id.toLowerCase().includes(search) ||
            a.summary.toLowerCase().includes(search) ||
            JSON.stringify(a).toLowerCase().includes(search);

        return matchesSeverity && matchesQueue && matchesSearch && matchesAllRows(a, filterRows);
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

    const handleEscalate = async (alertId: string) => {
        console.log('Escalating alert:', alertId);
        const targetAlert = alerts.find(a => a.id === alertId);
        if (!targetAlert) return;

        const incidentId = `${alertId}-incident`;
        try {
            // 1. Create the incident document
            const incidentRef = doc(db, 'incidents', incidentId);
            await setDoc(incidentRef, {
                id: incidentId,
                title: `Incident: ${targetAlert.alert_name}`,
                alertIds: [alertId],
                theories: [],
                done: [],
                todo: [
                    { id: '1', description: 'Investigate root cause', completedAt: null, completedBy: null },
                    { id: '2', description: 'Contain the threat', completedAt: null, completedBy: null }
                ],
                playbookRef: null,
                slackLink: null,
                createdAt: Date.now()
            });

            // 2. Update the alert status
            const alertRef = doc(db, 'alerts', alertId);
            await updateDoc(alertRef, {
                status: 'ESCALATED',
                incidentId: incidentId
            });

            // 3. Navigate to the new incident
            navigate(`/incident/${incidentId}`);
        } catch (err) {
            console.error('Error creating incident:', err);
            alert('Failed to create incident. See console for details.');
        }
    };

    const handleResolve = async (alertId: string, resolution: AlertResolution | null, impact: AlertImpact | null) => {
        console.log('Updating alert resolution:', alertId, resolution, impact);
        try {
            const isResolved = !!(resolution && impact);
            const alertRef = doc(db, 'alerts', alertId);
            await updateDoc(alertRef, {
                status: isResolved ? 'RESOLVED' : 'OPEN',
                resolution,
                impact,
                resolved_at: isResolved ? new Date() : null
            });
            if (isResolved) setSelectedAlert(null);
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

    const handleCreateIncident = async () => {
        const incidentId = `incident-${Math.random().toString(36).substr(2, 9)}`;
        try {
            const incidentRef = doc(db, 'incidents', incidentId);
            await setDoc(incidentRef, {
                id: incidentId,
                title: `Manual Incident: ${new Date().toLocaleDateString()}`,
                alertIds: [],
                theories: [],
                done: [],
                todo: [
                    { id: '1', description: 'Investigate source', completedAt: null, completedBy: null }
                ],
                playbookRef: null,
                slackLink: null,
                createdAt: Date.now()
            });
            navigate(`/incident/${incidentId}`);
        } catch (err) {
            console.error('Error creating manual incident:', err);
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
                onCreateIncident={handleCreateIncident}
                counts={counts}
            />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <Header
                    presences={presences.filter(p => p.activeContextId === 'triage-queue')}
                    title="Triage Queue"
                    searchTerm={searchTerm}
                    searchPlaceholder="Search alerts..."
                    onSearchChange={setSearchTerm}
                />

                <FilterBar
                    rows={filterRows}
                    onRowsChange={setFilterRows}
                    matchedCount={filteredAlerts.length}
                    totalCount={alerts.length}
                    itemsLabel="alerts"
                    fieldPlaceholder="field (e.g. severity, events[0].details.sourceipaddress)"
                    suggestions={[
                        'severity', 'status', 'alert_name', 'category', 'tags', 'summary',
                        'assigneeName', 'resolution', 'impact', 'events[0].details.',
                    ]}
                />

                <TriageQueue
                    alerts={filteredAlerts}
                    presences={presences}
                    columns={columns}
                    onAlertClick={handleAlertClick}
                    onClaim={handleClaim}
                    onUnclaim={handleUnclaim}
                    onAddColumn={handleAddColumn}
                    onRemoveColumn={handleRemoveColumn}
                    onColumnsChange={updateColumns}
                    currentUserId={user?.uid}
                    loading={loading}
                    hasMore={hasMore}
                    onLoadMore={loadMore}
                />
            </main>

            <ActionCanvas
                alert={selectedAlert ? alerts.find(a => a.id === selectedAlert.id) ?? selectedAlert : null}
                onClose={() => setSelectedAlert(null)}
                onEscalate={handleEscalate}
                onResolve={handleResolve}
                onAction={handleAction}
            />
        </div>
    );
};
