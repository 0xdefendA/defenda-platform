import { Shield } from 'lucide-react';
import { AvatarCluster } from '../ui/AvatarCluster';
import type { Presence } from '../../types';

interface HeaderProps {
    presences?: Presence[];
}

export const Header = ({ presences = [] }: HeaderProps) => {
    return (
        <header className="sticky top-0 z-50 w-full h-12 bg-surface border-b border-border px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <span className="font-heading font-bold text-lg tracking-tight">respondA</span>
            </div>

            <div className="flex items-center gap-4">
                {presences.length > 0 && (
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-muted uppercase tracking-widest">Active Analysts</span>
                        <AvatarCluster presences={presences} />
                    </div>
                )}
            </div>
        </header>
    );
};
