import type { AlertResolution, AlertImpact } from '../../types';

interface AlertResolutionFormProps {
    onResolve: (resolution: AlertResolution, impact: AlertImpact) => void;
}

export const AlertResolutionForm = ({ onResolve }: AlertResolutionFormProps) => {
    const resolutions: AlertResolution[] = ['true_positive', 'false_positive', 'true_negative', 'false_negative'];
    const impacts: AlertImpact[] = ['maximum', 'high', 'medium', 'low', 'none'];

    return (
        <div className="space-y-6 bg-surface p-4 rounded-xl border border-border shadow-sm">
            <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Resolution</label>
                <div className="grid grid-cols-2 gap-2">
                    {resolutions.map((res) => (
                        <button
                            key={res}
                            onClick={() => (window as any)._pendingRes = res}
                            className="px-3 py-2 rounded-lg border border-border text-xs hover:border-primary hover:text-primary transition-all capitalize focus:bg-primary/10 focus:border-primary"
                        >
                            {res.replace('_', ' ')}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Impact</label>
                <div className="flex flex-wrap gap-2">
                    {impacts.map((imp) => (
                        <button
                            key={imp}
                            onClick={() => {
                                const res = (window as any)._pendingRes;
                                if (res) onResolve(res, imp);
                                else alert('Please select a resolution first');
                            }}
                            className="px-4 py-2 rounded-lg border border-border text-xs hover:border-primary hover:text-primary transition-all capitalize"
                        >
                            {imp}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
