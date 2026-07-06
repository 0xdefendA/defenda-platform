import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, ShieldAlert, HeartPulse } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Alert, AlertResolution, AlertImpact } from '../../types';
import { SeverityBadge } from '../ui/SeverityBadge';
import { TelemetryBlock } from './TelemetryBlock';
import { AlertResolutionForm } from './AlertResolution';
import { useKey } from 'react-use';

interface ActionCanvasProps {
    alert: Alert | null;
    onClose: () => void;
    onEscalate: (alertId: string) => void;
    onResolve: (alertId: string, resolution: AlertResolution | null, impact: AlertImpact | null) => void;
}

export const ActionCanvas = ({
    alert,
    onClose,
    onEscalate,
    onResolve
}: ActionCanvasProps) => {
    useKey("Escape", () => {
        if (alert !== null) {
            onClose();
        }
    }, {}, [alert, onClose]);

    return (
        <AnimatePresence>
            {alert && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
                    />
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed top-0 right-0 h-full w-[60%] bg-surface z-[70] shadow-2xl flex flex-col border-l border-border"
                    >
                        {/* Canvas Header */}
                        <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-surface/80 backdrop-blur-md sticky top-0">
                            <div className="flex items-center gap-3">
                                <SeverityBadge severity={alert.severity.toLowerCase() as any} />
                                <h2 className="font-heading font-bold text-lg">{alert.alert_name}</h2>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => onEscalate(alert.id)}
                                    className="flex items-center gap-2 text-xs font-bold text-primary hover:underline"
                                >
                                    <ExternalLink className="w-3 h-3" />
                                    Escalate to Incident
                                </button>
                                <button onClick={onClose} className="p-1 hover:bg-muted rounded-full transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto">
                            <div className="p-6 space-y-8">
                                {/* Deadman trigger status: repeated triggers fold into
                                    this alert, so hits + recency show whether the
                                    absence is ongoing or has recovered. */}
                                {alert.alert_type === 'deadman' && alert.deadman_hits && (
                                    <DeadmanStatus
                                        hits={alert.deadman_hits}
                                        lastTriggeredAt={alert.last_triggered_at}
                                    />
                                )}

                                {/* Alert Details Section */}
                                <section className="space-y-4">
                                    <div className="flex justify-between items-end">
                                        <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Telemetry Payload</label>
                                        <span className="text-[10px] font-mono text-muted">ID: {alert.id}</span>
                                    </div>
                                    <TelemetryBlock payload={alert.events} />
                                </section>

                                <div className="grid grid-cols-5 gap-8">
                                    {/* Alert Context Section */}
                                    <section className="col-span-3 space-y-4">
                                        <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted block">Alert Context</label>
                                        <div className="border border-border rounded-xl p-4 grid grid-cols-2 gap-x-6 gap-y-3">
                                            <ContextField label="Category" value={alert.category || '—'} />
                                            <ContextField label="Rule type" value={alert.alert_type || 'threshold'} />
                                            <ContextField label="Status" value={alert.status} />
                                            <ContextField
                                                label="Created (UTC)"
                                                value={(alert.created_at as any)?.toDate?.()?.toISOString().replace('T', ' ').slice(0, 19) || '—'}
                                            />
                                            <ContextField label="Events attached" value={String(alert.events?.length ?? 0)} />
                                            <ContextField label="Assignee" value={alert.assigneeName || 'Unassigned'} />
                                            <div className="col-span-2">
                                                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted block mb-1">Tags</span>
                                                {alert.tags?.length ? (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {alert.tags.map(tag => (
                                                            <span key={tag} className="px-2 py-0.5 border border-border-color rounded font-mono text-[10px] text-muted">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted">—</span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-muted leading-relaxed">
                                            Summary: <span className="text-text-main">{alert.summary}</span>
                                        </p>
                                    </section>

                                    {/* Resolution Section or Linked Incident */}
                                    <section className="col-span-2 space-y-4">
                                        {alert.status === 'ESCALATED' ? (
                                            <div className="bg-primary/5 border border-primary/20 p-6 rounded-xl space-y-4">
                                                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                                                    <ShieldAlert className="w-5 h-5" />
                                                    Escalated to Incident
                                                </div>
                                                <p className="text-xs text-muted leading-relaxed">
                                                    This alert is part of an ongoing investigation. All actions and notes should be recorded in the incident workspace.
                                                </p>
                                                <Link
                                                    to={`/incident/${(alert as any).incidentId || `${alert.id}-incident`}`}
                                                    className="flex items-center justify-center gap-2 w-full bg-primary text-white py-2 rounded-lg text-xs font-bold hover:bg-primary/90 transition-all shadow-sm shadow-primary/20"
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                    View Incident Workspace
                                                </Link>
                                            </div>
                                        ) : (
                                            <>
                                                <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted block">Resolve Alert</label>
                                                <AlertResolutionForm
                                                    currentResolution={alert.resolution}
                                                    currentImpact={alert.impact}
                                                    onResolve={(res, imp) => onResolve(alert.id, res, imp)}
                                                />
                                            </>
                                        )}
                                    </section>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

const ContextField = ({ label, value }: { label: string; value: string }) => (
    <div>
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted block mb-1">{label}</span>
        <span className="text-xs font-mono text-text-main break-all">{value}</span>
    </div>
);

const DeadmanStatus = ({ hits, lastTriggeredAt }: { hits: number; lastTriggeredAt?: any }) => {
    const lastDate: Date | null = lastTriggeredAt?.toDate?.() ?? null;
    const minutesAgo = lastDate ? Math.round((Date.now() - lastDate.getTime()) / 60000) : null;
    // alertA evaluates every minute; if the last hit is recent, the absence is ongoing.
    const ongoing = minutesAgo !== null && minutesAgo <= 3;

    return (
        <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 ${ongoing ? 'border-accent/30 bg-accent/5' : 'border-success/30 bg-success/5'}`}>
            <HeartPulse className={`w-5 h-5 shrink-0 ${ongoing ? 'text-accent' : 'text-success'}`} />
            <div className="flex flex-col">
                <span className={`text-sm font-bold ${ongoing ? 'text-accent' : 'text-success'}`}>
                    {ongoing ? 'Deadman still firing — absence is ongoing' : 'Deadman quiet — events are flowing again'}
                </span>
                <span className="text-xs text-muted font-mono">
                    {hits} trigger{hits === 1 ? '' : 's'}
                    {minutesAgo !== null && ` · last ${minutesAgo <= 1 ? 'about a minute' : `${minutesAgo} minutes`} ago`}
                </span>
            </div>
        </div>
    );
};
