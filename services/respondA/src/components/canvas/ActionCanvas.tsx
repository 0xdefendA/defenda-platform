import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Alert, AlertResolution, AlertImpact } from '../../types';
import { SeverityBadge } from '../ui/SeverityBadge';
import { TelemetryBlock } from './TelemetryBlock';
import { ParryRiposte } from './ParryRiposte';
import { AlertResolutionForm } from './AlertResolution';
import { useKey } from 'react-use';

interface ActionCanvasProps {
    alert: Alert | null;
    onClose: () => void;
    onEscalate: (alertId: string) => void;
    onResolve: (alertId: string, resolution: AlertResolution | null, impact: AlertImpact | null) => void;
    onAction: (alertId: string, type: 'parry' | 'riposte', action: string) => void;
}

export const ActionCanvas = ({
    alert,
    onClose,
    onEscalate,
    onResolve,
    onAction
}: ActionCanvasProps) => {
    useKey('Escape', () => {
        onClose();

    });

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
                                {/* Alert Details Section */}
                                <section className="space-y-4">
                                    <div className="flex justify-between items-end">
                                        <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Telemetry Payload</label>
                                        <span className="text-[10px] font-mono text-muted">ID: {alert.id}</span>
                                    </div>
                                    <TelemetryBlock payload={alert.events} />
                                </section>

                                <div className="grid grid-cols-5 gap-8">
                                    {/* Response Actions Section */}
                                    <section className="col-span-3 space-y-4">
                                        <ParryRiposte onAction={(type, action) => onAction(alert.id, type, action)} />
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
