import { useAuth } from '../../hooks/useAuth';

interface SidebarProps {
    severityFilter: string | null;
    onSeverityFilterChange: (severity: string | null) => void;
    counts: {
        total: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
}

export const Sidebar = ({ severityFilter, onSeverityFilterChange, counts }: SidebarProps) => {
    const { user } = useAuth();

    const severities = [
        { id: 'critical', label: 'Critical', count: counts.critical },
        { id: 'high', label: 'High', count: counts.high },
        { id: 'medium', label: 'Medium', count: counts.medium },
        { id: 'low', label: 'Low', count: counts.low },
    ];

    return (
        <aside className="w-[240px] flex-shrink-0 border-r border-thin border-border-color bg-surface flex flex-col h-full z-10 hidden md:flex">
            {/* Logo Area */}
            <div className="h-[48px] flex items-center px-4 border-b border-thin border-border-color">
                <h1 className="font-display font-bold text-xl tracking-tight text-text-main flex items-center gap-2">
                    <span className="text-primary material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>swords</span>
                    respondA
                </h1>
            </div>

            {/* Navigation Links */}
            <div className="flex flex-col py-4 px-2 space-y-1">
                <a className="flex items-center gap-3 px-3 py-2 text-sm font-medium bg-row-hover text-text-main border-l-2 border-primary" href="#">
                    <span className="material-symbols-outlined text-[20px]">shield</span>
                    All Alerts
                    <span className="ml-auto font-mono text-xs text-muted">{counts.total}</span>
                </a>
                <a className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted hover:bg-row-hover hover:text-text-main border-l-2 border-transparent hover:border-border-color transition-colors" href="#">
                    <span className="material-symbols-outlined text-[20px]">verified_user</span>
                    My Queue
                    <span className="ml-auto font-mono text-xs text-muted">3</span>
                </a>
                <a className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted hover:bg-row-hover hover:text-text-main border-l-2 border-transparent hover:border-border-color transition-colors" href="#">
                    <span className="material-symbols-outlined text-[20px]">warning</span>
                    Escalated
                    <span className="ml-auto font-mono text-xs text-accent">2</span>
                </a>
            </div>

            {/* Filters Section */}
            <div className="mt-4 px-5 flex flex-col gap-4 flex-grow overflow-y-auto">
                <h3 className="font-display text-xs font-semibold text-muted uppercase tracking-wider mb-2 border-b border-thin border-border-color pb-1">Filters</h3>

                {/* Severity Filter */}
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium text-text-main">Severity</h4>
                        {severityFilter && (
                            <button
                                onClick={() => onSeverityFilterChange(null)}
                                className="text-[10px] text-primary hover:underline uppercase font-bold"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        {severities.map((s) => (
                            <label
                                key={s.id}
                                className="flex items-center gap-2 text-sm text-muted cursor-pointer hover:text-text-main group"
                                onClick={() => onSeverityFilterChange(s.id === severityFilter ? null : s.id)}
                            >
                                <div className={`w-4 h-4 border border-border-color flex items-center justify-center group-hover:border-primary transition-colors ${severityFilter === s.id ? 'bg-primary border-primary' : ''}`}>
                                    <span className={`material-symbols-outlined text-[14px] ${severityFilter === s.id ? 'text-white opacity-100' : 'text-primary opacity-0'}`}>
                                        check
                                    </span>
                                </div>
                                {s.label}
                                <span className="ml-auto font-mono text-[10px]">{s.count}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Entity Filter */}
                <div className="flex flex-col gap-2 mt-4">
                    <h4 className="text-xs font-medium text-text-main">Entity Type</h4>
                    <div className="flex flex-wrap gap-2">
                        <button className="px-2 py-1 text-xs font-medium border border-border-color hover:border-primary hover:text-primary transition-colors">Endpoint</button>
                        <button className="px-2 py-1 text-xs font-medium border border-border-color hover:border-primary hover:text-primary transition-colors bg-row-hover">Network</button>
                        <button className="px-2 py-1 text-xs font-medium border border-border-color hover:border-primary hover:text-primary transition-colors">Identity</button>
                        <button className="px-2 py-1 text-xs font-medium border border-border-color hover:border-primary hover:text-primary transition-colors">Cloud</button>
                    </div>
                </div>
            </div>

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
