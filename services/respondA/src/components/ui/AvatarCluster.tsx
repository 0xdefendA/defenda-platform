import type { Presence } from '../../types';

interface AvatarClusterProps {
    presences: Presence[];
    limit?: number;
}

export const AvatarCluster = ({ presences, limit = 4 }: AvatarClusterProps) => {
    const visiblePresences = presences.slice(0, limit);
    const remaining = presences.length - limit;

    return (
        <div className="flex -space-x-2 overflow-hidden">
            {visiblePresences.map((presence) => (
                <div
                    key={presence.userId}
                    className="inline-block h-6 w-6 rounded-full ring-2 ring-surface bg-muted flex items-center justify-center text-[10px] font-bold text-white uppercase"
                    style={{ backgroundColor: (presence as any).userColor || '#868E96' }}
                    title={(presence as any).userName || presence.userId}
                >
                    {((presence as any).userName || presence.userId).substring(0, 1)}
                </div>
            ))}
            {remaining > 0 && (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-white ring-2 ring-surface">
                    +{remaining}
                </div>
            )}
        </div>
    );
};
