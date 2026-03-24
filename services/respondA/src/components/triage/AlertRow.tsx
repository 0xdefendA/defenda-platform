import type { Alert, Presence } from '../../types';
import { SeverityBadge } from '../ui/SeverityBadge';

interface AlertRowProps {
    alert: Alert;
    presences: Presence[];
    onClick: (alert: Alert) => void;
    onClaim: (alertId: string) => void;
    onUnclaim: (alertId: string) => void;
    currentUserId?: string;
}

export const AlertRow = ({ alert, presences, onClick, onClaim, onUnclaim, currentUserId }: AlertRowProps) => {
    const isUnassigned = !alert.assigneeId;
    const isAssignedToMe = alert.assigneeId === currentUserId;
    const activeAnalyst = presences.length > 0 ? presences[0] : null;

    return (
        <div
            onClick={(e) => {
                // Don't trigger open if clicking action buttons
                if ((e.target as HTMLElement).closest('button')) return;
                onClick(alert);
            }}
            className="grid grid-cols-[80px_100px_minmax(250px,_1fr)_minmax(150px,_200px)_120px_100px] md:grid-cols-[80px_100px_minmax(250px,_1fr)_minmax(150px,_200px)_120px_100px] lg:grid-cols-[80px_100px_minmax(300px,_1fr)_minmax(150px,_200px)_120px_100px] items-center px-4 py-3 border-b border-thin border-border-color hover:bg-row-hover group transition-colors cursor-pointer relative"
        >
            {/* Presence Indicator line */}
            {activeAnalyst && (
                <div
                    className="absolute left-0 top-0 bottom-0 w-[2px] z-10"
                    style={{ backgroundColor: (activeAnalyst as any).userColor || '#0055FF' }}
                />
            )}

            <div className="pl-2">
                <SeverityBadge severity={alert.severity.toLowerCase() as any} />
            </div>

            <div className="font-mono text-xs text-text-main truncate pr-2">
                {alert.id.substring(0, 8).toUpperCase()}
            </div>

            <div className="font-medium text-sm text-text-main pr-4 truncate" title={alert.alert_name}>
                {alert.alert_name}
            </div>

            <div className="hidden md:block text-sm text-muted font-mono truncate">
                {alert.summary || 'No entity'}
            </div>

            <div className="hidden md:flex justify-end pr-4">
                {isUnassigned ? (
                    <span className="text-xs text-muted font-mono italic">Unassigned</span>
                ) : (
                    <div className="w-6 h-6 rounded-full border border-surface overflow-hidden bg-muted flex items-center justify-center text-[10px] font-mono font-bold text-white">
                        {alert.assigneeId?.substring(0, 2).toUpperCase() || '??'}
                    </div>
                )}
            </div>

            <div className="text-right pr-2 flex justify-end gap-2">
                {isUnassigned ? (
                    <button
                        onClick={() => onClaim(alert.id)}
                        className="opacity-0 group-hover:opacity-100 font-display text-[11px] font-bold uppercase tracking-wider text-primary border border-primary px-3 py-1 hover:bg-primary hover:text-white transition-colors"
                    >
                        Claim
                    </button>
                ) : isAssignedToMe ? (
                    <button
                        onClick={() => onUnclaim(alert.id)}
                        className="opacity-0 group-hover:opacity-100 font-display text-[11px] font-bold uppercase tracking-wider text-muted border border-muted px-3 py-1 hover:bg-muted hover:text-white transition-colors"
                    >
                        Unclaim
                    </button>
                ) : null}
                <button
                    onClick={() => onClick(alert)}
                    className="opacity-0 group-hover:opacity-100 font-display text-[11px] font-bold uppercase tracking-wider text-primary border border-primary px-3 py-1 hover:bg-primary hover:text-white transition-colors"
                >
                    Open
                </button>
            </div>
        </div>
    );
};
