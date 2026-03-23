import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, MessageSquare, BookOpen, Share2 } from 'lucide-react';
import { useIncident } from '../../hooks/useIncident';
import { usePresence } from '../../hooks/usePresence';
import { Header } from '../layout/Header';
import { TheoryBoard } from './TheoryBoard';
import { TaskList } from './TaskList';

export const IncidentWorkspace = () => {
    const { id } = useParams<{ id: string }>();
    const { incident, loading } = useIncident(id);
    const { presences } = usePresence(id || null);

    if (loading) return <div className="p-8">Loading incident...</div>;
    if (!incident) return <div className="p-8 text-accent">Incident not found</div>;

    return (
        <div className="flex flex-col h-screen bg-background">
            <Header presences={presences} />

            {/* Sub-header */}
            <div className="h-14 border-b border-border bg-surface px-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/" className="p-2 hover:bg-muted rounded-full transition-colors text-muted hover:text-text">
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <div className="space-y-0.5">
                        <h1 className="font-heading font-bold text-lg leading-tight">{incident.title}</h1>
                        <div className="flex items-center gap-3 text-[10px] text-muted font-mono uppercase tracking-widest">
                            <span>Incident ID: {incident.id}</span>
                            {incident.slackLink && (
                                <a href={incident.slackLink} target="_blank" className="flex items-center gap-1 text-primary hover:underline">
                                    <MessageSquare className="w-3 h-3" /> Slack
                                </a>
                            )}
                            {incident.playbookRef && (
                                <a href={incident.playbookRef} target="_blank" className="flex items-center gap-1 text-primary hover:underline">
                                    <BookOpen className="w-3 h-3" /> Playbook
                                </a>
                            )}
                        </div>
                    </div>
                </div>
                <button className="flex items-center gap-2 bg-primary/5 border border-primary/20 text-primary px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/10 transition-all">
                    <Share2 className="w-4 h-4" />
                    Summarize & Share
                </button>
            </div>

            {/* 4-Quadrant Workspace */}
            <div className="flex-1 p-6 grid grid-cols-2 grid-rows-2 gap-6 overflow-hidden">
                {/* Q1: Timeline (Placeholder for now) */}
                <div className="bg-surface rounded-xl border border-border p-4 shadow-sm flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 text-primary font-heading font-bold uppercase tracking-widest text-xs mb-4">
                        Timeline
                    </div>
                    <div className="flex-1 flex items-center justify-center text-muted italic text-sm">
                        Live Timeline integration coming in Step 7
                    </div>
                </div>

                {/* Q2: Active Theories */}
                <div className="bg-surface rounded-xl border border-border p-4 shadow-sm overflow-hidden">
                    <TheoryBoard
                        theories={incident.theories || []}
                        onAdd={(desc, lik) => console.log('Add theory', desc, lik)}
                        onRemove={(id) => console.log('Remove theory', id)}
                    />
                </div>

                {/* Q3: Actions Taken (HAVEDONE) */}
                <div className="bg-surface rounded-xl border border-border p-4 shadow-sm overflow-hidden">
                    <TaskList
                        title="Actions Taken"
                        type="done"
                        tasks={incident.done || []}
                    />
                </div>

                {/* Q4: Next Steps (TODO) */}
                <div className="bg-surface rounded-xl border border-border p-4 shadow-sm overflow-hidden">
                    <TaskList
                        title="Next Steps"
                        type="todo"
                        tasks={incident.todo || []}
                        onAdd={(desc) => console.log('Add task', desc)}
                        onToggle={(id) => console.log('Toggle task', id)}
                    />
                </div>
            </div>
        </div>
    );
};
