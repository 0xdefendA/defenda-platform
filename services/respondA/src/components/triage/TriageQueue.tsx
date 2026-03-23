import type { Alert, Presence } from '../../types';
import { AlertRow } from './AlertRow';

interface TriageQueueProps {
    alerts: Alert[];
    presences: Presence[];
    onAlertClick: (alert: Alert) => void;
    loading: boolean;
}

export const TriageQueue = ({ alerts, presences, onAlertClick, loading }: TriageQueueProps) => {
    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto bg-surface">
            <table className="w-full border-collapse">
                <thead>
                    <tr className="bg-muted/10 border-b border-border h-10">
                        <th className="px-4 py-2 text-left text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Severity</th>
                        <th className="px-4 py-2 text-left text-[10px] font-mono font-bold uppercase tracking-widest text-muted">ID</th>
                        <th className="px-4 py-2 text-left text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Title</th>
                        <th className="px-4 py-2 text-left text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Entity</th>
                        <th className="px-4 py-2 text-left text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Timestamp</th>
                        <th className="px-4 py-2 text-right text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Presence</th>
                    </tr>
                </thead>
                <tbody>
                    {alerts.map((alert) => (
                        <AlertRow
                            key={alert.id}
                            alert={alert}
                            presences={presences.filter(p => p.activeContextId === alert.id)}
                            onClick={onAlertClick}
                        />
                    ))}
                    {alerts.length === 0 && (
                        <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-muted italic">
                                No active alerts in queue.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};
