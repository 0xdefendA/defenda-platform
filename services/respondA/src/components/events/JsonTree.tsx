import { useState } from 'react';
import { Check, Columns, Copy, Filter } from 'lucide-react';
import { rowForJsonPath, type CriteriaRow, type JsonPath } from '../../lib/rules';
import { pathToString } from '../../lib/columns';

interface JsonTreeProps {
    data: unknown;
    onAddCondition: (row: CriteriaRow) => void;
    onAddColumn: (path: JsonPath) => void;
}

/**
 * Interactive JSON viewer. Hovering a scalar field reveals three actions:
 * add `field = value` to the query (filter icon — clicking the text does the
 * same), add the field as a result column (columns icon), or copy the raw
 * value to the clipboard (copy icon).
 */
export const JsonTree = ({ data, onAddCondition, onAddColumn }: JsonTreeProps) => {
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const handleCopy = async (id: string, value: unknown) => {
        const text = typeof value === 'string' ? value : String(value);
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(cur => (cur === id ? null : cur)), 1200);
        } catch (err) {
            console.error('Clipboard write failed:', err);
        }
    };

    return (
        <div className="text-[11px] font-mono leading-[1.7]">
            <Node
                value={data}
                path={[]}
                onAddCondition={onAddCondition}
                onAddColumn={onAddColumn}
                copiedId={copiedId}
                onCopy={handleCopy}
            />
        </div>
    );
};

interface NodeProps {
    value: unknown;
    path: JsonPath;
    onAddCondition: (row: CriteriaRow) => void;
    onAddColumn: (path: JsonPath) => void;
    copiedId: string | null;
    onCopy: (id: string, value: unknown) => void;
}

const Node = (props: NodeProps) => {
    const { value, path } = props;

    if (Array.isArray(value)) {
        return (
            <>
                <span className="text-muted">[</span>
                <div className="pl-4">
                    {value.map((item, i) => (
                        <div key={i}>
                            <Node {...props} value={item} path={[...path, i]} />
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
                    {entries.map(([key, val], i) => (
                        <div key={key}>
                            <KeyValue {...props} objKey={key} value={val} path={[...path, key]} />
                            {i < entries.length - 1 && <span className="text-muted">,</span>}
                        </div>
                    ))}
                </div>
                <span className="text-muted">{'}'}</span>
            </>
        );
    }

    return <Leaf {...props} />;
};

const ActionIcons = ({ row, path, value, onAddCondition, onAddColumn, copiedId, onCopy }: {
    row: CriteriaRow;
    path: JsonPath;
    value: unknown;
    onAddCondition: (row: CriteriaRow) => void;
    onAddColumn: (path: JsonPath) => void;
    copiedId: string | null;
    onCopy: (id: string, value: unknown) => void;
}) => {
    const id = pathToString(path);
    return (
        <span className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
                onClick={(e) => { e.stopPropagation(); onAddCondition(row); }}
                title={`Add to query: ${row.field} = ${row.value}`}
                className="p-0.5 rounded text-primary hover:bg-primary/20"
            >
                <Filter className="w-3 h-3" />
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); onAddColumn(path); }}
                title={`Add column: ${row.field}`}
                className="p-0.5 rounded text-primary hover:bg-primary/20"
            >
                <Columns className="w-3 h-3" />
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); onCopy(id, value); }}
                title="Copy value"
                className="p-0.5 rounded text-primary hover:bg-primary/20"
            >
                {copiedId === id ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
            </button>
        </span>
    );
};

const KeyValue = (props: NodeProps & { objKey: string }) => {
    const { objKey, value, path, onAddCondition } = props;
    const isScalar = value === null || typeof value !== 'object';
    const row = isScalar ? rowForJsonPath(path, value) : null;

    if (row) {
        return (
            <span className="group inline-flex items-baseline gap-1 rounded px-1 -mx-1 hover:bg-primary/10 transition-colors">
                <button
                    onClick={() => onAddCondition(row)}
                    title={`Add to query: ${row.field} = ${row.value}`}
                    className="inline-flex items-baseline gap-1 text-left"
                >
                    <span className="text-primary">"{objKey}"</span>
                    <span className="text-muted">:</span>
                    <ScalarValue value={value} />
                </button>
                <ActionIcons {...props} row={row} value={value} />
            </span>
        );
    }

    if (isScalar) {
        // Not filterable (e.g. utctimestamp) — still copyable.
        return (
            <span className="group inline-flex items-baseline gap-1 rounded px-1 -mx-1 hover:bg-primary/10 transition-colors">
                <span className="text-primary">"{objKey}"</span>
                <span className="text-muted">:</span>
                <ScalarValue value={value} />
                <CopyOnly {...props} />
            </span>
        );
    }

    return (
        <>
            <span className="text-primary">"{objKey}"</span>
            <span className="text-muted">: </span>
            <Node {...props} />
        </>
    );
};

const CopyOnly = ({ value, path, copiedId, onCopy }: NodeProps) => {
    const id = pathToString(path);
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onCopy(id, value); }}
            title="Copy value"
            className="p-0.5 rounded text-primary hover:bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity self-center"
        >
            {copiedId === id ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
        </button>
    );
};

const Leaf = (props: NodeProps) => {
    const { value, path, onAddCondition } = props;
    const row = rowForJsonPath(path, value);
    if (row) {
        return (
            <span className="group inline-flex items-baseline gap-1 rounded px-1 -mx-1 hover:bg-primary/10 transition-colors">
                <button
                    onClick={() => onAddCondition(row)}
                    title={`Add to query: ${row.field} = ${row.value}`}
                    className="text-left"
                >
                    <ScalarValue value={value} />
                </button>
                <ActionIcons {...props} row={row} value={value} />
            </span>
        );
    }
    return <ScalarValue value={value} />;
};

const ScalarValue = ({ value }: { value: unknown }) => {
    if (value === null || value === undefined) return <span className="text-muted italic">null</span>;
    if (typeof value === 'string') return <span className="text-text-main break-all">"{value}"</span>;
    if (typeof value === 'boolean') return <span className="text-accent">{String(value)}</span>;
    return <span className="text-success">{String(value)}</span>;
};
