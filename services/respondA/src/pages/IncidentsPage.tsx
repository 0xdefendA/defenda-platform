import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { ColumnPicker } from '../components/ui/ColumnPicker';
import { FilterBar } from '../components/ui/FilterBar';
import { format } from 'date-fns';
import { ArrowDown, ArrowUp, ShieldAlert, ChevronRight, X } from 'lucide-react';
import type { Incident } from '../types';
import type { CriteriaRow, JsonPath } from '../lib/rules';
import {
    INCIDENTS_COLUMNS_KEY, INCIDENT_DEFAULT_COLUMNS, columnForPath, compareValues,
    formatCellValue, getValueAtPath, loadColumns, saveColumns, type EventColumn,
} from '../lib/columns';
import { matchesAllRows } from '../lib/filter';
import { useColumnDrag } from '../hooks/useColumnDrag';
import { usePresence } from '../hooks/usePresence';
import { useColumnResize } from '../hooks/useColumnResize';

// Width hints for well-known columns; anything else shares remaining space.
const COLUMN_WIDTHS: Record<string, string> = {
    id: '100px',
    title: 'minmax(300px, 1fr)',
    createdAt: '150px',
    alertIds: '120px',
    tasks: '120px',
};

type SortDir = 'asc' | 'desc';

export const IncidentsPage = () => {
    const navigate = useNavigate();
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRows, setFilterRows] = useState<CriteriaRow[]>([]);
    const [sort, setSort] = useState<{ id: string; dir: SortDir }>({ id: 'createdAt', dir: 'desc' });
    const [columns, setColumns] = useState<EventColumn[]>(
        () => loadColumns(INCIDENTS_COLUMNS_KEY, INCIDENT_DEFAULT_COLUMNS)
    );
    const { presences } = usePresence('incidents-list');

    useEffect(() => {
        const q = query(
            collection(db, 'incidents'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const incidentData: Incident[] = [];
            snapshot.forEach((doc) => {
                incidentData.push({ id: doc.id, ...doc.data() } as Incident);
            });
            setIncidents(incidentData);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const updateColumns = (next: EventColumn[]) => {
        setColumns(next);
        saveColumns(INCIDENTS_COLUMNS_KEY, next);
    };

    const { handlers: dragHandlers, headerClass: dragClass } = useColumnDrag(columns, updateColumns);
    const { resizeHandleProps } = useColumnResize(columns, updateColumns);

    const handleAddColumn = (path: JsonPath, label?: string) => {
        const col = columnForPath(path, label);
        if (columns.some(c => c.id === col.id)) return;
        updateColumns([...columns, col]);
    };

    const handleRemoveColumn = (id: string) => {
        updateColumns(columns.filter(c => c.id !== id));
    };

    const handleSort = (id: string) => {
        setSort(prev =>
            prev.id === id
                ? { id, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { id, dir: id === 'createdAt' ? 'desc' : 'asc' }
        );
    };

    const handleCreateIncident = async () => {
        const incidentId = `incident-${Math.random().toString(36).substr(2, 9)}`;
        try {
            const incidentRef = doc(db, 'incidents', incidentId);
            await setDoc(incidentRef, {
                id: incidentId,
                title: `Manual Incident: ${new Date().toLocaleDateString()}`,
                alertIds: [],
                theories: [],
                done: [],
                todo: [
                    { id: '1', description: 'Investigate source', completedAt: null, completedBy: null }
                ],
                playbookRef: null,
                slackLink: null,
                createdAt: Date.now()
            });
            navigate(`/incident/${incidentId}`);
        } catch (err) {
            console.error('Error creating manual incident:', err);
        }
    };

    // Derived columns sort by their meaningful number, not the raw value.
    const sortValue = (incident: Incident, col: EventColumn): unknown => {
        if (col.id === 'alertIds') return incident.alertIds?.length ?? 0;
        if (col.id === 'tasks') return incident.done?.length ?? 0;
        return getValueAtPath(incident, col.path);
    };

    const filteredIncidents = useMemo(() => {
        const search = searchTerm.toLowerCase();
        const matched = incidents.filter(i => {
            const matchesSearch = !searchTerm ||
                i.title.toLowerCase().includes(search) ||
                i.id.toLowerCase().includes(search);
            return matchesSearch && matchesAllRows(i, filterRows);
        });

        const col = columns.find(c => c.id === sort.id);
        if (!col) return matched;
        return [...matched].sort((a, b) => {
            const va = sortValue(a, col);
            const vb = sortValue(b, col);
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            const base = compareValues(va, vb);
            return sort.dir === 'asc' ? base : -base;
        });
    }, [incidents, searchTerm, filterRows, columns, sort]);

    const gridTemplate = [
        ...columns.map(c => (c.width ? `${c.width}px` : COLUMN_WIDTHS[c.id] ?? 'minmax(110px, 1fr)')),
        '100px',
    ].join(' ');

    return (
        <div className="flex h-screen bg-background-light dark:bg-background-dark text-text-main overflow-hidden">
            <Sidebar onCreateIncident={handleCreateIncident} />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <Header
                    presences={presences}
                    title="Incidents"
                    searchTerm={searchTerm}
                    searchPlaceholder="Search incidents..."
                    onSearchChange={setSearchTerm}
                />

                <FilterBar
                    rows={filterRows}
                    onRowsChange={setFilterRows}
                    matchedCount={filteredIncidents.length}
                    totalCount={incidents.length}
                    itemsLabel="incidents"
                    fieldPlaceholder="field (e.g. title, playbookRef, theories[0].description)"
                    suggestions={['title', 'id', 'playbookRef', 'slackLink', 'theories[0].description', 'todo[0].description']}
                />

                <div className="flex-1 overflow-auto bg-surface relative">
                    {/* w-max: rows grow with resized columns so separators span full width */}
                    <div className="w-max min-w-full">
                    {/* Table Header */}
                    <div className="sticky top-0 bg-background-light border-b border-thin border-border-color z-20">
                        <div
                            className="grid items-center px-6 py-2 text-[10px] font-display text-muted uppercase tracking-wider h-10"
                            style={{ gridTemplateColumns: gridTemplate }}
                        >
                            {columns.map((col, i) => (
                                <div
                                    key={col.id}
                                    {...dragHandlers(i)}
                                    className={`group relative flex items-center gap-1 cursor-pointer select-none hover:text-text-main transition-colors ${dragClass(i)}`}
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
                                        onClick={(e) => { e.stopPropagation(); handleRemoveColumn(col.id); }}
                                        title={`Remove column ${col.label}`}
                                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-opacity shrink-0"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                    <span {...resizeHandleProps(i)} />
                                </div>
                            ))}
                            <div className="flex items-center justify-end gap-1">
                                <span>Actions</span>
                                <ColumnPicker
                                    columns={columns}
                                    defaults={INCIDENT_DEFAULT_COLUMNS}
                                    onAddColumn={handleAddColumn}
                                    placeholder="playbookRef"
                                    tip="Any incident field works, including paths like theories[0].description."
                                />
                            </div>
                        </div>
                    </div>

                    {/* Table Body */}
                    <div className="flex flex-col">
                        {loading ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
                            </div>
                        ) : filteredIncidents.map((incident) => (
                            <div
                                key={incident.id}
                                onClick={() => navigate(`/incident/${incident.id}`)}
                                className="grid items-center px-6 py-4 border-b border-thin border-border-color hover:bg-row-hover group transition-colors cursor-pointer"
                                style={{ gridTemplateColumns: gridTemplate }}
                            >
                                {columns.map(col => (
                                    <IncidentCell key={col.id} incident={incident} col={col} />
                                ))}
                                <div className="text-right">
                                    <ChevronRight className="w-5 h-5 text-muted opacity-0 group-hover:opacity-100 transition-all ml-auto" />
                                </div>
                            </div>
                        ))}

                        {!loading && filteredIncidents.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 bg-surface">
                                <p className="font-display text-2xl font-semibold text-muted text-center">
                                    No incidents found. <br />
                                    <span className="text-sm font-normal italic">All clear on the horizon.</span>
                                </p>
                            </div>
                        )}
                    </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

const IncidentCell = ({ incident, col }: { incident: Incident; col: EventColumn }) => {
    const value = getValueAtPath(incident, col.path);

    switch (col.id) {
        case 'id':
            return (
                <div className="font-mono text-xs text-text-main truncate pr-4">
                    {incident.id
                        .replace(/^incident-/, '')
                        .replace(/-incident$/, '')
                        .substring(0, 8)
                        .toUpperCase()}
                </div>
            );
        case 'title':
            return (
                <div className="font-medium text-sm text-text-main flex items-center gap-2 truncate pr-4" title={incident.title}>
                    <ShieldAlert className="w-4 h-4 text-primary shrink-0" />
                    <span className="truncate">{incident.title}</span>
                </div>
            );
        case 'createdAt':
            return (
                <div className="text-xs text-muted font-mono">
                    {typeof value === 'number' ? format(value, 'yyyy-MM-dd HH:mm') : '—'}
                </div>
            );
        case 'alertIds':
            return (
                <div className="text-center">
                    <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[10px] font-bold">
                        {incident.alertIds?.length || 0}
                    </span>
                </div>
            );
        case 'tasks':
            return (
                <div className="text-center">
                    <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-success/10 text-success font-mono text-[10px] font-bold">
                        {incident.done?.length || 0}/{(incident.todo?.length || 0) + (incident.done?.length || 0)}
                    </span>
                </div>
            );
        default: {
            const text = formatCellValue(value);
            return (
                <div className="text-xs text-muted font-mono truncate pr-2" title={text === '—' ? col.id : text}>
                    {text}
                </div>
            );
        }
    }
};
