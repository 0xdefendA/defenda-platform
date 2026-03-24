import { useState } from 'react';
import { AvatarCluster } from '../ui/AvatarCluster';
import type { Presence } from '../../types';

interface HeaderProps {
    presences?: Presence[];
    searchTerm?: string;
    onSearchChange?: (term: string) => void;
}

export const Header = ({ presences = [], searchTerm = '', onSearchChange }: HeaderProps) => {
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    return (
        <header className="h-[48px] bg-surface border-b border-thin border-border-color flex items-center justify-between px-6 flex-shrink-0 z-10 w-full sticky top-0">
            <div className="flex items-center gap-4">
                {/* Mobile Menu Trigger */}
                <button className="md:hidden text-text-main hover:text-primary">
                    <span className="material-symbols-outlined">menu</span>
                </button>
                <h2 className="font-display text-sm font-semibold tracking-wide uppercase text-muted">Triage Queue</h2>
            </div>

            {/* Multiplayer Presence */}
            <div className="flex items-center gap-3">
                <div className="flex items-center">
                    {isSearchOpen ? (
                        <div className="relative flex items-center">
                            <input
                                autoFocus
                                type="text"
                                value={searchTerm}
                                onChange={(e) => onSearchChange?.(e.target.value)}
                                placeholder="Search alerts..."
                                className="h-8 w-48 lg:w-64 pl-8 pr-2 border border-primary text-xs focus:outline-none focus:ring-0"
                                onBlur={() => !searchTerm && setIsSearchOpen(false)}
                            />
                            <span className="material-symbols-outlined absolute left-2 text-[16px] text-primary">search</span>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsSearchOpen(true)}
                            className="w-8 h-8 flex items-center justify-center border border-border-color text-muted hover:text-text-main hover:border-text-main transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px]">search</span>
                        </button>
                    )}
                </div>

                <span className="text-xs text-muted font-mono hidden sm:inline-block ml-2">
                    {presences.length} Active {presences.length === 1 ? 'Analyst' : 'Analysts'}
                </span>
                <AvatarCluster presences={presences} />
            </div>
        </header>
    );
};
