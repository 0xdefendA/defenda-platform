import type { Presence } from '../../types';

interface AvatarClusterProps {
    presences: Presence[];
    limit?: number;
}

export const AvatarCluster = ({ presences, limit = 4 }: AvatarClusterProps) => {
    const visiblePresences = presences.slice(0, limit);

    return (
        <div className="flex -space-x-2">
            {visiblePresences.map((presence, idx) => {
                const userName = (presence as any).userName || presence.userId;
                const initials = userName.substring(0, 2).toUpperCase();
                const userColor = (presence as any).userColor || '#0055FF';
                const userPhoto = (presence as any).userPhoto;

                return (
                    <div
                        key={presence.userId}
                        className="w-6 h-6 rounded-full border-2 border-surface relative group cursor-pointer ring-1 bg-surface"
                        style={{
                            zIndex: 30 - idx,
                            boxShadow: `0 0 0 1px ${userColor}`
                        }}
                        title={userName}
                    >
                        {userPhoto ? (
                            <img alt={userName} className="w-full h-full object-cover rounded-full" src={userPhoto} />
                        ) : (
                            <div className="w-full h-full rounded-full bg-row-hover flex items-center justify-center text-[10px] font-mono font-bold text-text-main">
                                {initials}
                            </div>
                        )}
                        <div
                            className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border border-surface"
                            style={{ backgroundColor: userColor }}
                        ></div>
                    </div>
                );
            })}
        </div>
    );
};
