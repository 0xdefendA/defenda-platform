import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { Reorder, useDragControls } from 'framer-motion';
import { X, GripVertical, Calendar, Clock, Globe, Trash2, Plus, MessageSquare } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useKey } from 'react-use';
import type { TimelineEvent } from '../../types';

interface TimelineEditorProps {
    events: TimelineEvent[];
    onUpdateEvent: (id: string, details: Partial<TimelineEvent>) => void;
    onReorderEvents: (events: TimelineEvent[]) => void;
    onDeleteEvent: (id: string) => void;
    onAddEvent: (details: Partial<TimelineEvent>) => void;
    onClose: () => void;
}

export const TimelineEditor = ({ events, onUpdateEvent, onReorderEvents, onDeleteEvent, onAddEvent, onClose }: TimelineEditorProps) => {
    const [items, setItems] = useState<TimelineEvent[]>(events);

    useKey('Escape', onClose);

    useEffect(() => {
        setItems(events);
    }, [events]);

    const handleReorder = (newOrder: TimelineEvent[]) => {
        setItems(newOrder);
        onReorderEvents(newOrder);
    };

    const handleUpdate = (id: string, field: keyof TimelineEvent, value: any) => {
        onUpdateEvent(id, { [field]: value });
    };

    const formatForInput = (timestamp: number, timezone: string = 'UTC') => {
        return formatInTimeZone(timestamp, timezone, "yyyy-MM-dd'T'HH:mm");
    };

    const handleDateTimeChange = (id: string, isoString: string, timezone: string = 'UTC') => {
        const date = fromZonedTime(isoString, timezone);
        handleUpdate(id, 'timestamp', date.getTime());
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
                    <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <Clock size={18} />
                        </div>
                        <h2 className="text-lg font-bold">Timeline Precision Editor</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
                    <Reorder.Group axis="y" values={items} onReorder={handleReorder} className="space-y-3">
                        {items.map((event) => (
                            <ReorderItem
                                key={event.id}
                                event={event}
                                onUpdate={handleUpdate}
                                onDateTimeChange={handleDateTimeChange}
                                onDelete={() => onDeleteEvent(event.id)}
                                formatForInput={formatForInput}
                            />
                        ))}
                    </Reorder.Group>
                </div>

                <div className="p-4 border-t border-border bg-muted/30 flex justify-between items-center gap-3">
                    <button
                        onClick={() => onAddEvent({ message: 'New historical event', timestamp: Date.now(), type: 'note' })}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                    >
                        <Plus size={16} /> Add Historical Event
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-lg transition-colors border border-border"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

interface ReorderItemProps {
    event: TimelineEvent;
    onUpdate: (id: string, field: keyof TimelineEvent, value: any) => void;
    onDateTimeChange: (id: string, isoString: string, timezone: string) => void;
    onDelete: () => void;
    formatForInput: (timestamp: number, timezone?: string) => string;
}

const ReorderItem = ({ event, onUpdate, onDateTimeChange, onDelete, formatForInput }: ReorderItemProps) => {
    const controls = useDragControls();
    const [localMessage, setLocalMessage] = useState(event.message);

    // Sync local message when event changes externally
    useEffect(() => {
        setLocalMessage(event.message);
    }, [event.message]);

    return (
        <Reorder.Item
            value={event}
            dragListener={false}
            dragControls={controls}
            className="bg-surface border border-border rounded-lg shadow-sm overflow-hidden flex"
        >
            <div
                className="w-10 flex items-center justify-center bg-muted/20 cursor-grab active:cursor-grabbing hover:bg-muted/40 transition-colors"
                onPointerDown={(e) => controls.start(e)}
            >
                <GripVertical size={16} className="text-muted" />
            </div>

            <div className="flex-1 p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                <div className="md:col-span-3 space-y-2">
                    <label className="text-[10px] font-bold text-muted uppercase flex items-center gap-1">
                        <Calendar size={10} /> Date and Time
                    </label>
                    <input
                        type="datetime-local"
                        value={formatForInput(event.timestamp, event.timezone)}
                        onChange={(e) => onDateTimeChange(event.id, e.target.value, event.timezone || 'UTC')}
                        className="w-full text-xs bg-background border border-border rounded focus:ring-1 focus:ring-primary outline-none"
                    />
                </div>

                <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-bold text-muted uppercase flex items-center gap-1">
                        <Globe size={10} /> Timezone
                    </label>
                    <select
                        value={event.timezone || 'UTC'}
                        onChange={(e) => onUpdate(event.id, 'timezone', e.target.value)}
                        className="w-full text-xs p-2 bg-background border border-border rounded focus:ring-1 focus:ring-primary outline-none"
                    >
                        <option value="UTC">UTC</option>
                        <option value={Intl.DateTimeFormat().resolvedOptions().timeZone}>Local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
                    </select>
                </div>

                <div className="md:col-span-6 space-y-2">
                    <label className="text-[10px] font-bold text-muted uppercase flex items-center gap-1">
                        <MessageSquare size={10} /> Event
                    </label>
                    <textarea
                        value={localMessage}
                        onChange={(e) => setLocalMessage(e.target.value)}
                        onBlur={() => {
                            if (localMessage !== event.message) {
                                onUpdate(event.id, 'message', localMessage);
                            }
                        }}
                        className="w-full text-xs p-2 bg-background border border-border rounded focus:ring-1 focus:ring-primary outline-none min-h-[60px]"
                    />
                </div>

                <div className="md:col-span-1 flex items-center justify-center pt-6">
                    <button
                        onClick={() => {
                            if (confirm('Delete this event?')) onDelete();
                        }}
                        className="p-2 text-muted hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        </Reorder.Item>
    );
};