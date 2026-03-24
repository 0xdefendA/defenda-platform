import { useState, useEffect } from 'react';
import type { AlertResolution, AlertImpact } from '../../types';

interface AlertResolutionFormProps {
    currentResolution?: AlertResolution | null;
    currentImpact?: AlertImpact | null;
    onResolve: (resolution: AlertResolution, impact: AlertImpact) => void;
}

export const AlertResolutionForm = ({ currentResolution, currentImpact, onResolve }: AlertResolutionFormProps) => {
    const [resolution, setResolution] = useState<AlertResolution | null>(null);
    const [impact, setImpact] = useState<AlertImpact | null>(null);

    useEffect(() => {
        if (currentResolution) setResolution(currentResolution);
        if (currentImpact) setImpact(currentImpact);
    }, [currentResolution, currentImpact]);

    const resolutions: AlertResolution[] = ['true_positive', 'false_positive', 'true_negative', 'false_negative'];
    const impacts: AlertImpact[] = ['maximum', 'high', 'medium', 'low', 'none'];

    const handleSelectResolution = (res: AlertResolution) => {
        setResolution(res);
        if (impact) onResolve(res, impact);
    };

    const handleSelectImpact = (imp: AlertImpact) => {
        setImpact(imp);
        if (resolution) onResolve(resolution, imp);
        else alert('Please select a resolution first');
    };

    return (
        <div className="space-y-6 bg-surface p-4 border border-border shadow-sm">
            <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">Resolution</label>
                <div className="grid grid-cols-2 gap-2">
                    {resolutions.map((res) => (
                        <button
                            key={res}
                            onClick={() => handleSelectResolution(res)}
                            className={`px-3 py-2 border text-xs transition-all capitalize ${resolution === res ? 'bg-primary border-primary text-white' : 'border-border hover:border-primary hover:text-primary'}`}
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
                            onClick={() => handleSelectImpact(imp)}
                            className={`px-4 py-2 border text-xs transition-all capitalize ${impact === imp ? 'bg-primary border-primary text-white' : 'border-border hover:border-primary hover:text-primary'}`}
                        >
                            {imp}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
