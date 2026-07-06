import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { Alert, Presence } from '../../types';
import type { JsonPath } from '../../lib/rules';
import {
    ALERT_DEFAULT_COLUMNS, compareValues, getValueAtPath, type EventColumn,
} from '../../lib/columns';
import { ColumnPicker } from '../ui/ColumnPicker';
import { AlertRow } from './AlertRow';
import { useColumnDrag } from '../../hooks/useColumnDrag';
import { useColumnResize } from '../../hooks/useColumnResize';
import { useProfiles } from '../../hooks/useProfiles';

interface TriageQueueProps {
    alerts: Alert[];
    presences: Presence[];
    columns: EventColumn[];
    onAlertClick: (alert: Alert) => void;
    onClaim: (alertId: string) => void;
    onUnclaim: (alertId: string) => void;
    onAddColumn: (path: JsonPath, label?: string) => void;
    onRemoveColumn: (id: string) => void;
    onColumnsChange: (next: EventColumn[]) => void; // reorder + resize
    currentUserId?: string;
    loading: boolean;
}

// Width hints for well-known columns; anything else shares remaining space.
const COLUMN_WIDTHS: Record<string, string> = {
    severity: '70px',
    id: '90px',
    created_at: '150px',
    alert_name: 'minmax(200px, 1.5fr)',
    summary: 'minmax(120px, 1fr)',
    resolution: '110px',
    impact: '100px',
    assigneeName: '110px',
};

export const gridTemplateFor = (columns: EventColumn[]): string =>
    [
        ...columns.map(c => (c.width ? `${c.width}px` : COLUMN_WIDTHS[c.id] ?? 'minmax(110px, 1fr)')),
        '150px',
    ].join(' ');

type SortDir = 'asc' | 'desc';

export const TriageQueue = ({
    alerts, presences, columns, onAlertClick, onClaim, onUnclaim,
    onAddColumn, onRemoveColumn, onColumnsChange, currentUserId, loading,
}: TriageQueueProps) => {
    const [sort, setSort] = useState<{ id: string; dir: SortDir }>({ id: 'created_at', dir: 'desc' });
    const { handlers: dragHandlers, headerClass: dragClass } = useColumnDrag(columns, onColumnsChange);
    const { resizeHandleProps } = useColumnResize(columns, onColumnsChange);
    const { profiles } = useProfiles();

    const handleSort = (id: string) => {
        setSort(prev =>
            prev.id === id
                ? { id, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { id, dir: id === 'created_at' ? 'desc' : 'asc' }
        );
    };

    const sortedAlerts = useMemo(() => {
        const col = columns.find(c => c.id === sort.id);
        if (!col) return alerts;
        return [...alerts].sort((a, b) => {
            const va = getValueAtPath(a, col.path);
            const vb = getValueAtPath(b, col.path);
            if (va == null && vb == null) return 0;
            if (va == null) return 1; // missing values always sort last
            if (vb == null) return -1;
            const base = compareValues(va, vb);
            return sort.dir === 'asc' ? base : -base;
        });
    }, [alerts, columns, sort]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
        );
    }

    const gridTemplate = gridTemplateFor(columns);

    return (
        <div className="flex-1 overflow-auto bg-surface relative">
            {/* w-max lets rows grow to the grid's content width when columns are
                resized wider than the viewport, so separators span the full row;
                min-w-full keeps everything viewport-wide otherwise. */}
            <div className="w-max min-w-full">
            {/* Table Header */}
            <div className="sticky top-0 bg-background-light border-b border-thin border-border-color z-20">
                <div
                    className="grid items-center px-4 py-2 text-[10px] font-display text-muted uppercase tracking-wider h-10"
                    style={{ gridTemplateColumns: gridTemplate }}
                >
                    {columns.map((col, i) => (
                        <div
                            key={col.id}
                            {...dragHandlers(i)}
                            className={`group relative flex items-center gap-1 cursor-pointer select-none hover:text-text-main transition-colors ${i === 0 ? 'pl-2' : ''} ${dragClass(i)}`}
                            title={`Sort by ${col.id} — drag to reorder`}
                            onClick={() => handleSort(col.id)}
                        >
                            <span className="truncate">{col.label}</span>
                            {sort.id === col.id && (
                                sort.dir === 'asc'
                                    ? <ArrowUp className="w-3 h-3 text-primary shrink-0" />
                                    : <ArrowDown className="w-3 h-3 text-primary shrink-0" />
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); onRemoveColumn(col.id); }}
                                title={`Remove column ${col.label}`}
                                className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-opacity shrink-0"
                            >
                                <X className="w-3 h-3" />
                            </button>
                            <span {...resizeHandleProps(i)} />
                        </div>
                    ))}
                    <div className="flex items-center justify-end gap-1 pr-2">
                        <span>Actions</span>
                        <ColumnPicker
                            columns={columns}
                            defaults={ALERT_DEFAULT_COLUMNS}
                            onAddColumn={onAddColumn}
                            placeholder="events[0].details.sourceipaddress"
                            tip="Any alert field works — including paths into the triggering events."
                        />
                    </div>
                </div>
            </div>

            {/* Table Body */}
            <div className="flex flex-col">
                {sortedAlerts.map((alert) => (
                    <AlertRow
                        key={alert.id}
                        alert={alert}
                        columns={columns}
                        profiles={profiles}
                        gridTemplate={gridTemplate}
                        presences={presences.filter(p => p.activeContextId === alert.id)}
                        onClick={onAlertClick}
                        onClaim={onClaim}
                        onUnclaim={onUnclaim}
                        currentUserId={currentUserId}
                    />
                ))}
                {sortedAlerts.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 bg-surface">
                        <p className="font-display text-2xl font-semibold text-muted">Queue Clear. En Garde.</p>
                    </div>
                )}
            </div>
            </div>
        </div>
    );
};
