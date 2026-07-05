import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Copy, Database, X } from 'lucide-react';
import { SeverityBadge } from '../ui/SeverityBadge';
import { ColumnPicker } from '../ui/ColumnPicker';
import { JsonTree } from './JsonTree';
import type { EventRecord } from '../../lib/queryApi';
import type { CriteriaRow, JsonPath } from '../../lib/rules';
import {
    EVENT_DEFAULT_COLUMNS, compareValues, formatCellValue, getValueAtPath,
    type EventColumn,
} from '../../lib/columns';

interface EventsTableProps {
    events: EventRecord[];
    loading: boolean;
    hasRun: boolean;
    columns: EventColumn[];
    onAddCondition: (row: CriteriaRow) => void;
    onAddColumn: (path: JsonPath) => void;
    onRemoveColumn: (id: string) => void;
}

type SortDir = 'asc' | 'desc';
interface SortState { id: string; dir: SortDir } // id 'time' = utctimestamp

export const EventsTable = ({
    events, loading, hasRun, columns, onAddCondition, onAddColumn, onRemoveColumn,
}: EventsTableProps) => {
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [sort, setSort] = useState<SortState>({ id: 'time', dir: 'desc' });

    const toggle = (i: number) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });
    };

    const handleSort = (id: string) => {
        setSort(prev =>
            prev.id === id
                ? { id, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { id, dir: id === 'time' ? 'desc' : 'asc' }
        );
        setExpanded(new Set()); // row positions change; collapse to avoid confusion
    };

    const sortedEvents = useMemo(() => {
        const col = columns.find(c => c.id === sort.id);
        const valueOf = (e: EventRecord): unknown =>
            sort.id === 'time' ? e.utctimestamp : col ? getValueAtPath(e, col.path) : undefined;

        return [...events].sort((a, b) => {
            const va = valueOf(a);
            const vb = valueOf(b);
            if (va == null && vb == null) return 0;
            if (va == null) return 1;  // missing values always sort last
            if (vb == null) return -1;
            const base = compareValues(va, vb);
            return sort.dir === 'asc' ? base : -base;
        });
    }, [events, columns, sort]);

    const SortArrow = ({ id }: { id: string }) =>
        sort.id === id
            ? sort.dir === 'asc'
                ? <ArrowUp className="w-3 h-3 text-primary" />
                : <ArrowDown className="w-3 h-3 text-primary" />
            : null;

    if (!hasRun && !loading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3 py-20">
                <Database className="w-10 h-10 opacity-30" />
                <p className="text-sm">Build a query and run it to explore the event data lake.</p>
            </div>
        );
    }

    if (!loading && events.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3 py-20">
                <Database className="w-10 h-10 opacity-30" />
                <p className="text-sm">No events matched. Widen the time range or loosen the criteria.</p>
            </div>
        );
    }

    const thClass = "px-3 py-2 font-display text-[10px] font-bold text-muted uppercase tracking-widest";

    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-surface z-10">
                    <tr className="border-b border-thin border-border-color">
                        <th className="w-8" />
                        <th
                            className={`${thClass} cursor-pointer select-none hover:text-text-main transition-colors`}
                            onClick={() => handleSort('time')}
                            title="Sort by time"
                        >
                            <span className="inline-flex items-center gap-1">
                                Time (UTC)
                                <SortArrow id="time" />
                            </span>
                        </th>
                        {columns.map(col => (
                            <th
                                key={col.id}
                                className={`${thClass} group whitespace-nowrap cursor-pointer select-none hover:text-text-main transition-colors`}
                                title={`Sort by ${col.id}`}
                                onClick={() => handleSort(col.id)}
                            >
                                <span className="inline-flex items-center gap-1">
                                    {col.label}
                                    <SortArrow id={col.id} />
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onRemoveColumn(col.id); }}
                                        title={`Remove column ${col.label}`}
                                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-opacity"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </span>
                            </th>
                        ))}
                        <th className="px-2 py-2 w-10">
                            <ColumnPicker
                                columns={columns}
                                defaults={EVENT_DEFAULT_COLUMNS}
                                onAddColumn={onAddColumn}
                                tip="Tip: use the column icon on any field in an expanded event."
                            />
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {sortedEvents.map((event, i) => (
                        <EventRow
                            key={event.eventid || i}
                            event={event}
                            columns={columns}
                            expanded={expanded.has(i)}
                            onToggle={() => toggle(i)}
                            onAddCondition={onAddCondition}
                            onAddColumn={onAddColumn}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
};

interface EventRowProps {
    event: EventRecord;
    columns: EventColumn[];
    expanded: boolean;
    onToggle: () => void;
    onAddCondition: (row: CriteriaRow) => void;
    onAddColumn: (path: JsonPath) => void;
}

const EventRow = ({ event, columns, expanded, onToggle, onAddCondition, onAddColumn }: EventRowProps) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.error('Clipboard write failed:', err);
        }
    };

    return (
        <>
            <tr
                onClick={onToggle}
                className="border-b border-thin border-border-color hover:bg-row-hover cursor-pointer transition-colors"
            >
                <td className="pl-2 text-muted">
                    {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-text-main whitespace-nowrap">
                    {event.utctimestamp?.replace('T', ' ').replace(/\+00:?00$/, '').slice(0, 19)}
                </td>
                {columns.map(col => <Cell key={col.id} event={event} col={col} />)}
                <td />
            </tr>
            {expanded && (
                <tr className="border-b border-thin border-border-color bg-background">
                    <td />
                    <td colSpan={columns.length + 2} className="px-3 py-3">
                        <div className="relative bg-surface border border-thin border-border-color rounded p-3 max-h-[400px] overflow-auto">
                            <div className="sticky top-0 float-right flex items-center gap-2">
                                <span className="text-[10px] text-muted hidden lg:inline">hover a field to filter or add a column</span>
                                <button
                                    onClick={handleCopy}
                                    title="Copy event JSON"
                                    className="flex items-center gap-1.5 border border-border-color bg-surface text-muted hover:text-text-main rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors"
                                >
                                    {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                                    {copied ? 'Copied' : 'Copy JSON'}
                                </button>
                            </div>
                            <JsonTree data={event} onAddCondition={onAddCondition} onAddColumn={onAddColumn} />
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
};

const Cell = ({ event, col }: { event: EventRecord; col: EventColumn }) => {
    const value = getValueAtPath(event, col.path);

    if (col.id === 'severity') {
        return (
            <td className="px-3 py-2">
                <SeverityBadge severity={String(value ?? 'info').toLowerCase()} />
            </td>
        );
    }

    const text = formatCellValue(value);
    return (
        <td
            className="px-3 py-2 font-mono text-xs text-text-main max-w-[360px] truncate"
            title={text === '—' ? col.id : text}
        >
            {text}
        </td>
    );
};
