import { ShieldAlert, Zap } from 'lucide-react';

interface ParryRiposteProps {
    onAction: (type: 'parry' | 'riposte', action: string) => void;
}

export const ParryRiposte = ({ onAction }: ParryRiposteProps) => {
    return (
        <div className="grid grid-cols-2 gap-4 h-full">
            <div className="space-y-4 border-r border-border pr-4">
                <div className="flex items-center gap-2 text-primary font-heading font-bold uppercase tracking-widest text-xs">
                    <ShieldAlert className="w-4 h-4" />
                    Parry (Quick Actions)
                </div>
                <div className="space-y-2">
                    <button
                        onClick={() => onAction('parry', 'Isolate Host')}
                        className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-sm group"
                    >
                        <div className="font-bold group-hover:text-primary transition-colors">Isolate Host</div>
                        <div className="text-[10px] text-muted">Instantly cut network access via EDR</div>
                    </button>
                    <button
                        onClick={() => onAction('parry', 'Disable Account')}
                        className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-sm group"
                    >
                        <div className="font-bold group-hover:text-primary transition-colors">Disable Account</div>
                        <div className="text-[10px] text-muted">Suspend user in IdP and revoke sessions</div>
                    </button>
                </div>
            </div>

            <div className="space-y-4 pl-2">
                <div className="flex items-center gap-2 text-accent font-heading font-bold uppercase tracking-widest text-xs">
                    <Zap className="w-4 h-4" />
                    Riposte (Playbooks)
                </div>
                <div className="space-y-2">
                    <button
                        onClick={() => onAction('riposte', 'Ransomware Containment')}
                        className="w-full text-left p-3 rounded-lg border border-accent/20 bg-accent/5 hover:bg-accent/10 transition-all text-sm group"
                    >
                        <div className="font-bold text-accent">Ransomware Containment</div>
                        <div className="text-[10px] text-muted">Automated evidence collection & forensic snap</div>
                    </button>
                    <button
                        onClick={() => onAction('riposte', 'Credential Leak Response')}
                        className="w-full text-left p-3 rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-all text-sm group"
                    >
                        <div className="font-bold group-hover:text-accent transition-colors">Credential Leak Response</div>
                        <div className="text-[10px] text-muted">Rotate keys, notify user, and audit logs</div>
                    </button>
                </div>
            </div>
        </div>
    );
};
