import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Database, AlertTriangle } from 'lucide-react';
import { useKey } from 'react-use';
import type { HuntReport, HuntFinding } from '../../types';

const VERDICT_STYLE: Record<string, string> = {
    findings: 'text-accent border-accent/30 bg-accent/5',
    nothing_of_concern: 'text-success border-success/30 bg-success/5',
    no_report: 'text-[#E67700] border-[#F59F00]/30 bg-[#FFF9DB]',
};

const CONFIDENCE_STYLE: Record<string, string> = {
    high: 'border-accent text-accent',
    medium: 'border-[#F59F00] text-[#F59F00]',
    low: 'border-muted text-muted',
};

export const HuntDetail = ({ hunt, onClose }: { hunt: HuntReport | null; onClose: () => void }) => {
    useKey('Escape', () => { if (hunt) onClose(); }, {}, [hunt, onClose]);

    return (
        <AnimatePresence>
            {hunt && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
                    />
                    <motion.div
                        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed top-0 right-0 h-full w-[60%] bg-surface z-[70] shadow-2xl flex flex-col border-l border-border-color"
                    >
                        {/* Header */}
                        <div className="h-14 border-b border-thin border-border-color flex items-center justify-between px-6 shrink-0">
                            <div className="flex items-center gap-3">
                                <Search className="w-4 h-4 text-primary" />
                                <h2 className="font-display font-bold text-base">Hunt {hunt.run_id}</h2>
                                <span className={`px-2 py-0.5 border rounded font-mono text-[10px] font-bold uppercase ${VERDICT_STYLE[hunt.verdict] || ''}`}>
                                    {hunt.verdict.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <button onClick={onClose} className="p-1 hover:bg-row-hover rounded-full transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-auto p-6 space-y-6">
                            {/* Run metadata */}
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                                <Meta label="Window" value={`${hunt.window?.since ?? '?'} → ${hunt.window?.until ?? '?'}`} />
                                <Meta label="Model" value={hunt.model} />
                                <Meta label="Queries run" value={String(hunt.cost?.queries ?? '—')} />
                                <Meta label="Bytes scanned" value={fmtBytes(hunt.cost?.bytes_scanned)} />
                                {hunt.cost?.budget_exhausted && <Meta label="⚠ Budget" value="exhausted (partial hunt)" />}
                                {hunt.cost?.llm_cap_exceeded && <Meta label="⚠ LLM cap" value="hit (partial hunt)" />}
                                {hunt.cost?.model_unavailable && <Meta label="⚠ Model" value={`unavailable — ${hunt.cost?.attempts ?? '?'} attempts (window NOT examined)`} />}
                            </div>

                            {/* Summary */}
                            <section>
                                <SectionLabel>Summary</SectionLabel>
                                <p className="text-sm text-text-main leading-relaxed whitespace-pre-wrap">{hunt.summary}</p>
                            </section>

                            {/* Findings */}
                            {hunt.findings.length > 0 ? (
                                <section className="space-y-3">
                                    <SectionLabel>Findings ({hunt.findings.length})</SectionLabel>
                                    {hunt.findings.map((f, i) => <FindingCard key={i} finding={f} />)}
                                </section>
                            ) : (
                                <section className="flex items-center gap-2 text-sm text-success border border-success/30 bg-success/5 rounded-lg px-4 py-3">
                                    <Database className="w-4 h-4 shrink-0" />
                                    Nothing warranted attention in this window.
                                </section>
                            )}

                            {/* Query trail — the evidence the verdict was earned, not asserted */}
                            <section>
                                <SectionLabel>Query trail ({queryCount(hunt)} queries)</SectionLabel>
                                <p className="text-[11px] text-muted mb-2">
                                    What the agent actually ran. A verdict is only as trustworthy as the hunt behind it.
                                </p>
                                <QueryTrail hunt={hunt} />
                            </section>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

const Meta = ({ label, value }: { label: string; value: string }) => (
    <div>
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted block">{label}</span>
        <span className="text-xs font-mono text-text-main break-all">{value}</span>
    </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <label className="text-[10px] font-display font-bold uppercase tracking-widest text-muted block mb-2">{children}</label>
);

const FindingCard = ({ finding }: { finding: HuntFinding }) => (
    <div className="border border-thin border-border-color rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-accent shrink-0" />
            <span className="font-medium text-sm text-text-main flex-1">{finding.title}</span>
            <span className={`px-1.5 py-0.5 border font-mono text-[10px] font-bold uppercase ${CONFIDENCE_STYLE[finding.confidence] || CONFIDENCE_STYLE.low}`}>
                {finding.confidence}
            </span>
        </div>
        <p className="text-xs text-text-main leading-relaxed">{finding.narrative}</p>
        <div className="text-[11px] text-muted">
            <span className="font-bold uppercase tracking-wide">Why not benign: </span>{finding.why_not_benign}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
            {finding.entities.map((e) => (
                <span key={e} className="px-2 py-0.5 border border-border-color rounded font-mono text-[10px] text-muted">{e}</span>
            ))}
        </div>
        {finding.evidence_eventids.length > 0 && (
            <div className="text-[10px] font-mono text-muted pt-1">
                cites: {finding.evidence_eventids.join(', ')}
            </div>
        )}
    </div>
);

const QueryTrail = ({ hunt }: { hunt: HuntReport }) => {
    const queries = (hunt.transcript || []).filter((r) => r.kind === 'query_run');
    if (queries.length === 0) {
        return (
            <div className="text-xs text-muted border border-thin border-border-color rounded-lg p-4">
                No query trail recorded for this run.
            </div>
        );
    }
    return (
        <ol className="space-y-2">
            {queries.map((q, i) => (
                <li key={i} className="border border-thin border-border-color rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-background border-b border-thin border-border-color">
                        <span className="font-mono text-[10px] font-bold text-primary">q{q.n ?? i + 1}</span>
                        <span className="font-mono text-[10px] text-muted">
                            {q.row_count ?? 0} rows{q.truncated ? ' (truncated)' : ''}
                            {typeof q.bytes === 'number' ? ` · ${fmtBytes(q.bytes)}` : ''}
                        </span>
                    </div>
                    <pre className="text-[11px] font-mono text-text-main whitespace-pre-wrap break-all p-3">{q.sql}</pre>
                </li>
            ))}
        </ol>
    );
};

const queryCount = (hunt: HuntReport) =>
    hunt.cost?.queries ?? (hunt.transcript || []).filter((r) => r.kind === 'query_run').length;

const fmtBytes = (b?: number) => {
    if (!b) return '—';
    if (b < 2 ** 20) return `${(b / 2 ** 10).toFixed(0)} KiB`;
    if (b < 2 ** 30) return `${(b / 2 ** 20).toFixed(1)} MiB`;
    return `${(b / 2 ** 30).toFixed(2)} GiB`;
};
