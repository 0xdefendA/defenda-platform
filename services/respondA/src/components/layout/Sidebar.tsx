import { useAuth } from '../../hooks/useAuth';
import { Link, useLocation } from 'react-router-dom';
import { Plus, LayoutGrid, ShieldAlert, Zap } from 'lucide-react';

interface SidebarProps {
    severityFilter?: string[];
    onSeverityFilterChange?: (severities: string[]) => void;
    queueFilter?: 'all' | 'my';
    onQueueFilterChange?: (filter: 'all' | 'my') => void;
    statusFilter?: string;
    onStatusFilterChange?: (status: string) => void;
    onCreateIncident?: () => void;
    counts?: {
        total: number;
        myQueue: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        info: number;
    };
}

export const Sidebar = ({ severityFilter = [], onSeverityFilterChange, queueFilter = 'all', onQueueFilterChange, statusFilter = 'OPEN', onStatusFilterChange, onCreateIncident, counts }: SidebarProps) => {
    const { user } = useAuth();
    const location = useLocation();
    const isAlertsPage = location.pathname === '/';
    const isIncidentsPage = location.pathname === '/incidents';

    const severities = counts ? [
        { id: 'critical', label: 'Critical', count: counts.critical },
        { id: 'high', label: 'High', count: counts.high },
        { id: 'medium', label: 'Medium', count: counts.medium },
        { id: 'low', label: 'Low', count: counts.low },
        { id: 'info', label: 'Info', count: counts.info },
    ] : [];

    return (
        <aside className="w-[240px] flex-shrink-0 border-r border-thin border-border-color bg-surface flex flex-col h-full z-10 hidden md:flex">
            {/* Logo Area */}
            <div className="h-[48px] flex items-center px-4 border-b border-thin border-border-color">
                <h1 className="font-display font-bold text-xl tracking-tight text-text-main flex items-center gap-2">
                    <span className="text-primary material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>swords</span>
                    respondA
                </h1>
            </div>

            {/* Global Navigation */}
            <div className="flex flex-col py-4 px-2 space-y-1">
                <h3 className="font-display text-[10px] font-bold text-muted uppercase tracking-widest px-3 mb-1">Navigation</h3>
                <Link
                    to="/"
                    className={`flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors border-l-2 ${isAlertsPage ? 'bg-row-hover text-text-main border-primary' : 'text-muted border-transparent hover:bg-row-hover'}`}
                >
                    <LayoutGrid className="w-4 h-4" />
                    Alerts
                </Link>
                <Link
                    to="/incidents"
                    className={`flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors border-l-2 ${isIncidentsPage ? 'bg-row-hover text-text-main border-primary' : 'text-muted border-transparent hover:bg-row-hover'}`}
                >
                    <ShieldAlert className="w-4 h-4" />
                    Incidents
                </Link>
                <div className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted/40 cursor-not-allowed">
                    <Zap className="w-4 h-4" />
                    Events
                </div>
            </div>

            {/* Contextual Action: Create Incident (Only on Incidents Page) */}
            {isIncidentsPage && (
                <div className="px-4 pb-4">
                    <button
                        onClick={onCreateIncident}
                        className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2 px-4 rounded-lg text-xs font-bold hover:bg-primary/90 transition-all shadow-sm shadow-primary/20"
                    >
                        <Plus className="w-4 h-4" />
                        Create Incident
                    </button>
                </div>
            )}

            {/* Alerts Contextual View Filters */}
            {isAlertsPage && counts && (
                <div className="flex flex-col py-2 px-2 space-y-1 border-t border-thin border-border-color">
                    <h3 className="font-display text-[10px] font-bold text-muted uppercase tracking-widest px-3 my-2">Queue</h3>
                    <button
                        onClick={() => onQueueFilterChange?.('all')}
                        className={`flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors border-l-2 ${queueFilter === 'all' ? 'bg-row-hover text-text-main border-primary' : 'text-muted border-transparent hover:bg-row-hover'}`}
                    >
                        <span className="material-symbols-outlined text-[20px]">shield</span>
                        All Alerts
                        <span className="ml-auto font-mono text-xs text-muted">{counts.total}</span>
                    </button>
                    <button
                        onClick={() => onQueueFilterChange?.('my')}
                        className={`flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors border-l-2 ${queueFilter === 'my' ? 'bg-row-hover text-text-main border-primary' : 'text-muted border-transparent hover:bg-row-hover'}`}
                    >
                        <span className="material-symbols-outlined text-[20px]">verified_user</span>
                        My Queue
                        <span className="ml-auto font-mono text-xs text-muted">{counts.myQueue}</span>
                    </button>
                </div>
            )}

            {/* Filters Section (Only on Alerts Page) */}
            {isAlertsPage && (
                <div className="mt-2 px-5 flex flex-col gap-4 flex-grow overflow-y-auto border-t border-thin border-border-color pt-4">
                    <h3 className="font-display text-xs font-semibold text-muted uppercase tracking-wider mb-2 border-b border-thin border-border-color pb-1">Filters</h3>

                    {/* Status Filter */}
                    <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-medium text-text-main">Status</h4>
                        <div className="flex gap-2">
                            <button
                                onClick={() => onStatusFilterChange?.('OPEN')}
                                className={`flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border transition-colors ${statusFilter === 'OPEN' ? 'bg-primary border-primary text-white' : 'border-border-color text-muted hover:border-primary hover:text-primary'}`}
                            >
                                Open
                            </button>
                            <button
                                onClick={() => onStatusFilterChange?.('RESOLVED')}
                                className={`flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border transition-colors ${statusFilter === 'RESOLVED' ? 'bg-primary border-primary text-white' : 'border-border-color text-muted hover:border-primary hover:text-primary'}`}
                            >
                                Resolved
                            </button>
                        </div>
                    </div>

                    {/* Severity Filter */}
                    {counts && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-medium text-text-main">Severity</h4>
                                {severityFilter.length > 0 && (
                                    <button
                                        onClick={() => onSeverityFilterChange?.([])}
                                        className="text-[10px] text-primary hover:underline uppercase font-bold"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            <div className="flex flex-col gap-1.5">
                                {severities.map((s) => {
                                    const isSelected = severityFilter.includes(s.id);
                                    return (
                                        <label
                                            key={s.id}
                                            className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-text-main group"
                                            onClick={() => {
                                                if (isSelected) {
                                                    onSeverityFilterChange?.(severityFilter.filter(id => id !== s.id));
                                                } else {
                                                    onSeverityFilterChange?.([...severityFilter, s.id]);
                                                }
                                            }}
                                        >
                                            <div className={`w-4 h-4 border border-border-color flex items-center justify-center group-hover:border-primary transition-colors ${isSelected ? 'bg-primary border-primary' : ''}`}>
                                                <span className={`material-symbols-outlined text-[14px] ${isSelected ? 'text-white opacity-100' : 'text-primary opacity-0'}`}>
                                                    check
                                                </span>
                                            </div>
                                            {s.label}
                                            <span className="ml-auto font-mono text-[10px]">{s.count}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* User Profile Area */}
            <div className="mt-auto border-t border-thin border-border-color p-4">
                <div className="flex items-center gap-3 cursor-pointer hover:bg-row-hover -mx-2 px-2 py-2 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-surface border-2 border-primary flex items-center justify-center overflow-hidden shrink-0">
                        {user?.photoURL ? (
                            <img alt="User Avatar" className="w-full h-full object-cover" src={user.photoURL} />
                        ) : (
                            <div className="w-full h-full bg-row-hover flex items-center justify-center text-[10px] font-mono font-bold text-text-main">
                                {user?.email?.substring(0, 2).toUpperCase() || '??'}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-medium leading-none mb-1">{user?.displayName || user?.email?.split('@')[0] || 'Analyst'}</span>
                        <span className="text-xs text-muted font-mono leading-none">Tier 2 Analyst</span>
                    </div>
                    <span className="material-symbols-outlined ml-auto text-muted text-[18px]">more_vert</span>
                </div>
            </div>
        </aside>
    );
};
