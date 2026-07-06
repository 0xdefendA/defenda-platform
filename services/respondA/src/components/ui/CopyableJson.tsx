import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * JSON viewer with click-to-copy: clicking a scalar value copies it raw
 * (no quotes) for pasting into other tools; hovering an object/array key
 * reveals a copy icon for the whole subtree as JSON.
 */
export const CopyableJson = ({ data }: { data: unknown }) => {
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const copy = async (id: string, value: unknown) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(cur => (cur === id ? null : cur)), 1200);
        } catch (err) {
            console.error('Clipboard write failed:', err);
        }
    };

    return (
        <div className="font-mono text-[11px] leading-[1.7]">
            <Node value={data} id="$" copiedId={copiedId} onCopy={copy} />
        </div>
    );
};

interface NodeProps {
    value: unknown;
    id: string; // path-ish identifier for copied-state feedback
    copiedId: string | null;
    onCopy: (id: string, value: unknown) => void;
}

const Node = ({ value, id, copiedId, onCopy }: NodeProps) => {
    if (Array.isArray(value)) {
        return (
            <>
                <span className="text-muted">[</span>
                <div className="pl-4">
                    {value.map((item, i) => (
                        <div key={i}>
                            <Node value={item} id={`${id}[${i}]`} copiedId={copiedId} onCopy={onCopy} />
                            {i < value.length - 1 && <span className="text-muted">,</span>}
                        </div>
                    ))}
                </div>
                <span className="text-muted">]</span>
            </>
        );
    }

    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        return (
            <>
                <span className="text-muted">{'{'}</span>
                <div className="pl-4">
                    {entries.map(([key, val], i) => {
                        const childId = `${id}.${key}`;
                        const isScalar = val === null || typeof val !== 'object';
                        return (
                            <div key={key} className="group/line">
                                <span className="text-primary">"{key}"</span>
                                <span className="text-muted">: </span>
                                {isScalar ? (
                                    <ScalarCopy value={val} id={childId} copiedId={copiedId} onCopy={onCopy} />
                                ) : (
                                    <>
                                        <CopyIcon
                                            id={childId}
                                            copied={copiedId === childId}
                                            title="Copy subtree JSON"
                                            onClick={() => onCopy(childId, val)}
                                        />
                                        <Node value={val} id={childId} copiedId={copiedId} onCopy={onCopy} />
                                    </>
                                )}
                                {i < entries.length - 1 && <span className="text-muted">,</span>}
                            </div>
                        );
                    })}
                </div>
                <span className="text-muted">{'}'}</span>
            </>
        );
    }

    return <ScalarCopy value={value} id={id} copiedId={copiedId} onCopy={onCopy} />;
};

const ScalarCopy = ({ value, id, copiedId, onCopy }: NodeProps) => {
    const copied = copiedId === id;
    return (
        <button
            onClick={() => onCopy(id, value)}
            title="Copy value"
            className="group/copy inline-flex items-baseline gap-1 rounded px-1 -mx-1 hover:bg-primary/10 transition-colors text-left align-baseline"
        >
            <ScalarValue value={value} />
            {copied ? (
                <Check className="w-3 h-3 self-center text-success" />
            ) : (
                <Copy className="w-3 h-3 self-center text-primary opacity-0 group-hover/copy:opacity-100 transition-opacity" />
            )}
        </button>
    );
};

const CopyIcon = ({ id, copied, title, onClick }: { id: string; copied: boolean; title: string; onClick: () => void }) => (
    <button
        key={id}
        onClick={onClick}
        title={title}
        className="inline-flex align-middle mr-1 p-0.5 rounded text-primary hover:bg-primary/10"
    >
        {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 opacity-0 group-hover/line:opacity-100 transition-opacity" />}
    </button>
);

const ScalarValue = ({ value }: { value: unknown }) => {
    if (value === null || value === undefined) return <span className="text-muted italic">null</span>;
    if (typeof value === 'string') return <span className="text-text-main break-all">"{value}"</span>;
    if (typeof value === 'boolean') return <span className="text-accent">{String(value)}</span>;
    return <span className="text-success">{String(value)}</span>;
};
