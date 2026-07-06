import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { CopyableJson } from '../ui/CopyableJson';

interface TelemetryBlockProps {
    payload: Record<string, any>;
}

export const TelemetryBlock = ({ payload }: TelemetryBlockProps) => {
    const [copiedAll, setCopiedAll] = useState(false);

    const handleCopyAll = async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            setCopiedAll(true);
            setTimeout(() => setCopiedAll(false), 1500);
        } catch (err) {
            console.error('Clipboard write failed:', err);
        }
    };

    return (
        <div className="relative bg-muted/10 rounded-lg p-4 overflow-auto max-h-[300px] border border-border">
            <div className="sticky top-0 float-right flex items-center gap-2">
                <span className="text-[10px] text-muted hidden lg:inline">click a value to copy</span>
                <button
                    onClick={handleCopyAll}
                    title="Copy full payload JSON"
                    className="flex items-center gap-1.5 border border-border-color bg-surface text-muted hover:text-text-main rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors"
                >
                    {copiedAll ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                    {copiedAll ? 'Copied' : 'Copy JSON'}
                </button>
            </div>
            <CopyableJson data={payload} />
        </div>
    );
};
