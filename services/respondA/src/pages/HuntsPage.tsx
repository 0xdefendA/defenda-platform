import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Radar, Search, CheckCircle2, AlertTriangle, HelpCircle, X } from 'lucide-react';
import { Sidebar } from '../components/layout/Sidebar';
import { HuntDetail } from '../components/hunts/HuntDetail';
import { useHunts } from '../hooks/useHunts';
import type { HuntReport, HuntVerdict } from '../types';

const VERDICT_META: Record<HuntVerdict, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
    findings: { label: 'Findings', className: 'text-accent border-accent', Icon: AlertTriangle },
    nothing_of_concern: { label: 'Clear', className: 'text-success border-success', Icon: CheckCircle2 },
    no_report: { label: 'No report', className: 'text-[#E67700] border-[#F59F00]', Icon: HelpCircle },
};

const fmtDate = (ts: any): string => {
    const d = ts?.toDate?.() ?? (typeof ts === 'number' ? new Date(ts) : null);
    return d ? format(d, 'yyyy-MM-dd HH:mm') : '—';
};

const VERDICT_FILTERS: { value: HuntVerdict | null; label: string }[] = [
    { value: null, label: 'All' },
    { value: 'findings', label: 'Findings' },
    { value: 'nothing_of_concern', label: 'Clear' },
    { value: 'no_report', label: 'No report' },
];

// Client-side text search over the loaded window: run id, summary, and any
// finding title / narrative / entity. (Verdict is filtered server-side.)
const matchesSearch = (hunt: HuntReport, term: string): boolean => {
    if (!term) return true;
    const t = term.toLowerCase();
    if (hunt.run_id?.toLowerCase().includes(t)) return true;
    if (hunt.summary?.toLowerCase().includes(t)) return true;
    return (hunt.findings || []).some(
        (f) =>
            f.title?.toLowerCase().includes(t) ||
            f.narrative?.toLowerCase().includes(t) ||
            (f.entities || []).some((e) => e.toLowerCase().includes(t))
    );
};

export const HuntsPage = () => {
    const [verdictFilter, setVerdictFilter] = useState<HuntVerdict | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const { hunts, loading, hasMore, loadMore } = useHunts(verdictFilter);
    const [selected, setSelected] = useState<HuntReport | null>(null);

    const filtered = useMemo(
        () => hunts.filter((h) => matchesSearch(h, searchTerm.trim())),
        [hunts, searchTerm]
    );

    const thClass = 'px-3 py-2 font-display text-[10px] font-bold text-muted uppercase tracking-widest';

    return (
        <div className="flex h-screen bg-background text-text-main overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="h-[48px] flex items-center gap-3 px-4 border-b border-thin border-border-color bg-surface flex-shrink-0">
                    <h1 className="font-display font-bold text-base text-text-main flex items-center gap-2">
                        <Search className="w-4 h-4 text-primary" />
                        Hunts
                    </h1>
                    <span className="text-xs text-muted hidden lg:inline">
                        Scheduled AI threat hunts (twice daily). Open a run to see its findings and the query trail behind the verdict.
                    </span>
                </div>

                {/* Filter + search bar */}
                <div className="flex items-center gap-3 px-4 py-2 border-b border-thin border-border-color bg-surface flex-shrink-0 flex-wrap">
                    <div className="flex border border-border-color rounded overflow-hidden">
                        {VERDICT_FILTERS.map((f) => (
                            <button
                                key={f.label}
                                onClick={() => setVerdictFilter(f.value)}
                                className={`px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${verdictFilter === f.value ? 'bg-primary text-white' : 'text-muted hover:text-text-main'}`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 text-muted absolute left-2 pointer-events-none" />
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search summary, findings, entities, run id…"
                            className="h-7 w-64 pl-7 pr-7 text-xs bg-background border border-border-color rounded text-text-main placeholder:text-muted/60"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-2 text-muted hover:text-text-main"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <span className="ml-auto font-mono text-[11px] text-muted">
                        {searchTerm ? `${filtered.length} of ${hunts.length} shown` : `${hunts.length} loaded`}
                    </span>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    <div className="border border-thin border-border-color bg-surface rounded-lg overflow-hidden">
                        {loading ? (
                            <div className="py-16 text-center text-sm text-muted">Loading hunts…</div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center text-muted gap-3 py-16">
                                <Radar className="w-10 h-10 opacity-30" />
                                <p className="text-sm">
                                    {hunts.length === 0
                                        ? (verdictFilter ? 'No runs match this verdict yet.' : 'No hunt runs yet. The scheduled hunt runs twice a day.')
                                        : 'No runs match your search in the loaded window. Try Load more.'}
                                </p>
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-thin border-border-color">
                                        <th className={thClass}>Run (UTC)</th>
                                        <th className={thClass}>Verdict</th>
                                        <th className={thClass}>Findings</th>
                                        <th className={thClass}>Window</th>
                                        <th className={thClass}>Queries</th>
                                        <th className={thClass}>Model</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((hunt) => {
                                        const meta = VERDICT_META[hunt.verdict] || VERDICT_META.no_report;
                                        const partial = hunt.cost?.budget_exhausted || hunt.cost?.llm_cap_exceeded || hunt.cost?.model_unavailable;
                                        return (
                                            <tr
                                                key={hunt.id}
                                                onClick={() => setSelected(hunt)}
                                                className="border-b border-thin border-border-color hover:bg-row-hover transition-colors cursor-pointer"
                                            >
                                                <td className="px-3 py-2 font-mono text-xs text-text-main">{fmtDate(hunt.created_at)}</td>
                                                <td className="px-3 py-2">
                                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 border rounded font-mono text-[10px] font-bold uppercase ${meta.className}`}>
                                                        <meta.Icon className="w-3 h-3" />
                                                        {meta.label}
                                                        {partial ? ' *' : ''}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 font-mono text-xs text-muted">{hunt.findings?.length ?? 0}</td>
                                                <td className="px-3 py-2 font-mono text-[11px] text-muted whitespace-nowrap">
                                                    {hunt.window?.since?.slice(5, 16)} → {hunt.window?.until?.slice(5, 16)}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-xs text-muted">{hunt.cost?.queries ?? '—'}</td>
                                                <td className="px-3 py-2 font-mono text-xs text-muted">{hunt.model}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {hasMore && (
                        <div className="flex items-center justify-center py-3">
                            <button
                                onClick={loadMore}
                                className="font-display text-[11px] font-bold uppercase tracking-wider text-primary border border-primary px-4 py-1.5 hover:bg-primary hover:text-white transition-colors"
                            >
                                Load more hunts
                            </button>
                        </div>
                    )}
                </div>
            </main>

            <HuntDetail hunt={selected} onClose={() => setSelected(null)} />
        </div>
    );
};
