import type { Alert, Presence } from '../../types';
import { SeverityBadge } from '../ui/SeverityBadge';
import { AvatarCluster } from '../ui/AvatarCluster';
import { format } from 'date-fns';

interface AlertRowProps {
    alert: Alert;
    presences: Presence[];
    onClick: (alert: Alert) => void;
}

export const AlertRow = ({ alert, presences, onClick }: AlertRowProps) => {
    return (
        <tr
            onClick={() => onClick(alert)}
            className="group hover:bg-muted/30 cursor-pointer border-b border-border transition-colors h-12"
        >
            <td className="px-4 py-2">
                <SeverityBadge severity={alert.severity} />
            </td>
            <td className="px-4 py-2 font-mono text-[10px] text-muted truncate max-w-[80px]" title={alert.id}>
                {alert.id.substring(0, 8)}
            </td>
            <td className="px-4 py-2 font-medium text-sm">
                {alert.title}
            </td>
            <td className="px-4 py-2 text-sm text-muted">
                {alert.entity}
            </td>
            <td className="px-4 py-2 text-xs text-muted font-mono">
                {format(alert.createdAt, 'HH:mm:ss')}
            </td>
            <td className="px-4 py-2 text-right">
                {presences.length > 0 && (
                    <AvatarCluster presences={presences} limit={3} />
                )}
            </td>
        </tr>
    );
};
