import { Columns, Filter } from 'lucide-react';
import { rowForJsonPath, type CriteriaRow, type JsonPath } from '../../lib/rules';

interface JsonTreeProps {
    data: unknown;
    onAddCondition: (row: CriteriaRow) => void;
    onAddColumn: (path: JsonPath) => void;
}

/**
 * Interactive JSON viewer. Hovering a scalar field reveals two actions:
 * add `field = value` to the query (filter icon — clicking the text does the
 * same), or add the field as a result column (columns icon).
 */
export const JsonTree = ({ data, onAddCondition, onAddColumn }: JsonTreeProps) => (
    <div className="text-[11px] font-mono leading-[1.7]">
        <Node value={data} path={[]} onAddCondition={onAddCondition} onAddColumn={onAddColumn} />
    </div>
);

interface NodeProps {
    value: unknown;
    path: JsonPath;
    onAddCondition: (row: CriteriaRow) => void;
    onAddColumn: (path: JsonPath) => void;
}

const Node = ({ value, path, onAddCondition, onAddColumn }: NodeProps) => {
    if (Array.isArray(value)) {
        return (
            <>
                <span className="text-muted">[</span>
                <div className="pl-4">
                    {value.map((item, i) => (
                        <div key={i}>
                            <Node value={item} path={[...path, i]} onAddCondition={onAddCondition} onAddColumn={onAddColumn} />
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
                            <KeyValue
                                objKey={key}
                                value={val}
                                path={[...path, key]}
                                onAddCondition={onAddCondition}
                                onAddColumn={onAddColumn}
                            />
                            {i < entries.length - 1 && <span className="text-muted">,</span>}
                        </div>
                    ))}
                </div>
                <span className="text-muted">{'}'}</span>
            </>
        );
    }

    return <Leaf value={value} path={path} onAddCondition={onAddCondition} onAddColumn={onAddColumn} />;
};

const ActionIcons = ({ row, path, onAddCondition, onAddColumn }: {
    row: CriteriaRow;
    path: JsonPath;
    onAddCondition: (row: CriteriaRow) => void;
    onAddColumn: (path: JsonPath) => void;
}) => (
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
    </span>
);

const KeyValue = ({ objKey, value, path, onAddCondition, onAddColumn }: NodeProps & { objKey: string }) => {
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
                <ActionIcons row={row} path={path} onAddCondition={onAddCondition} onAddColumn={onAddColumn} />
            </span>
        );
    }

    return (
        <>
            <span className="text-primary">"{objKey}"</span>
            <span className="text-muted">: </span>
            <Node value={value} path={path} onAddCondition={onAddCondition} onAddColumn={onAddColumn} />
        </>
    );
};

const Leaf = ({ value, path, onAddCondition, onAddColumn }: NodeProps) => {
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
                <ActionIcons row={row} path={path} onAddCondition={onAddCondition} onAddColumn={onAddColumn} />
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
