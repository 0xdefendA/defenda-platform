import { formatInTimeZone } from 'date-fns-tz';
import { Send, Settings2, Globe } from 'lucide-react';
import { useState } from 'react';
import type { TimelineEvent } from '../../types';

interface LiveTimelineProps {
    events: TimelineEvent[];
    onSendMessage: (message: string) => void;
    onOpenEditor: () => void;
}

export const LiveTimeline = ({ events, onSendMessage, onOpenEditor }: LiveTimelineProps) => {
    const [message, setMessage] = useState('');
    const [useLocalTime, setUseLocalTime] = useState(false);

    const handleSend = () => {
        if (!message.trim()) return;
        onSendMessage(message);
        setMessage('');
    };

    const currentTimezone = useLocalTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-4 bg-muted/30 p-2 rounded-lg border border-border">
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => setUseLocalTime(!useLocalTime)}
                        className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-background border border-border rounded hover:bg-muted transition-colors"
                    >
                        <Globe size={10} />
                        {useLocalTime ? 'Local' : 'UTC'}
                    </button>
                </div>
                <button 
                    onClick={onOpenEditor}
                    className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 rounded hover:bg-primary/20 transition-colors"
                >
                    <Settings2 size={10} />
                    Open Editor
                </button>
            </div>

            <div className="flex-1 overflow-auto space-y-4 pr-2 custom-scrollbar">
                <div className="relative pl-8">
                    {/* Vertical Track Line */}
                    <div className="absolute left-[11px] top-2 bottom-2 w-[1px] bg-border" />

                    <div className="space-y-6">
                        {events.map((event) => (
                            <div key={event.id} className="relative">
                                {/* Timeline Dot/Avatar */}
                                <div className="absolute -left-[29px] top-1">
                                    {event.type === 'system' ? (
                                        <div className="h-[15px] w-[15px] rounded-full border-2 border-surface bg-muted ring-4 ring-background" />
                                    ) : (
                                        <div className="h-6 w-6 rounded-full border-2 border-surface bg-primary ring-4 ring-background flex items-center justify-center text-[10px] text-white font-bold uppercase">
                                            {event.actorId.substring(0, 1)}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-1 group">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-mono text-muted uppercase tracking-widest">
                                                {formatInTimeZone(event.timestamp, currentTimezone, 'yyyy-MM-dd HH:mm:ss')}
                                                {event.editedAt && (
                                                    <span className="ml-2 italic">(edited)</span>
                                                )}
                                            </span>
                                            {event.type !== 'system' && (
                                                <span className="text-xs font-bold text-text">
                                                    {event.actorId === 'system' ? 'System' : event.actorId}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`text-sm leading-relaxed p-2 rounded-lg border 
                    ${event.type === 'system' ? 'bg-muted/5 border-transparent text-muted italic' : 'bg-surface border-border shadow-sm'}`}>
                                        {event.message}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border flex gap-2">
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Add a note or update..."
                    className="flex-1 p-2 text-sm bg-muted/20 border border-border rounded-full px-4 focus:ring-1 focus:ring-primary outline-none"
                />
                <button
                    onClick={handleSend}
                    className="bg-primary text-white p-2 rounded-full hover:bg-primary/90 transition-colors"
                >
                    <Send className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};