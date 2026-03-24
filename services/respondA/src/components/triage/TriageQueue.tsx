import type { Alert, Presence } from '../../types';
import { AlertRow } from './AlertRow';

interface TriageQueueProps {
    alerts: Alert[];
    presences: Presence[];
    onAlertClick: (alert: Alert) => void;
    onClaim: (alertId: string) => void;
    onUnclaim: (alertId: string) => void;
    currentUserId?: string;
    loading: boolean;
}

export const TriageQueue = ({ alerts, presences, onAlertClick, onClaim, onUnclaim, currentUserId, loading }: TriageQueueProps) => {
    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto bg-surface relative">
            {/* Table Header */}
            <div className="sticky top-0 bg-background-light border-b border-thin border-border-color z-20">
                <div className="grid grid-cols-[80px_100px_minmax(250px,_1fr)_minmax(150px,_200px)_120px_100px] md:grid-cols-[80px_100px_minmax(250px,_1fr)_minmax(150px,_200px)_120px_100px] lg:grid-cols-[80px_100px_minmax(300px,_1fr)_minmax(150px,_200px)_120px_100px] items-center px-4 py-2 text-xs font-display text-muted uppercase tracking-wider h-10">
                    <div className="pl-2">Severity</div>
                    <div>Alert ID</div>
                    <div>Title</div>
                    <div className="hidden md:block">Entity</div>
                    <div className="hidden md:block text-right pr-4">Assignee</div>
                    <div className="text-right pr-2">Actions</div>
                </div>
            </div>

            {/* Table Body */}
            <div className="flex flex-col">
                {alerts.map((alert) => (
                    <AlertRow
                        key={alert.id}
                        alert={alert}
                        presences={presences.filter(p => p.activeContextId === alert.id)}
                        onClick={onAlertClick}
                        onClaim={onClaim}
                        onUnclaim={onUnclaim}
                        currentUserId={currentUserId}
                    />
                ))}
                {alerts.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 bg-surface">
                        <p className="font-display text-2xl font-semibold text-muted">Queue Clear. En Garde.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
