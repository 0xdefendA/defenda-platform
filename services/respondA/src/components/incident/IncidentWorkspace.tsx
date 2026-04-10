import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { ChevronLeft, MessageSquare, BookOpen, Share2, AlertCircle } from 'lucide-react';
import { collection, addDoc, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useIncident } from '../../hooks/useIncident';
import { usePresence } from '../../hooks/usePresence';
import { useTimeline } from '../../hooks/useTimeline';
import { useAuth } from '../../hooks/useAuth';
import { Header } from '../layout/Header';
import { TheoryBoard } from './TheoryBoard';
import { TaskList } from './TaskList';
import { SummaryModal } from './SummaryModal';
import { generateMarkdownSummary } from '../../lib/summary';
import { LiveTimeline } from '../timeline/LiveTimeline';
import { TimelineEditor } from '../timeline/TimelineEditor';
import { InlineEdit } from '../ui/InlineEdit';
import type { Likelihood, TimelineEvent } from '../../types';

export const IncidentWorkspace = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const [isSummaryOpen, setIsSummaryOpen] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const { incident, loading } = useIncident(id);
    const { presences } = usePresence(id || null);
    const { events, updateEventDetails, reorderEvents, deleteEvent } = useTimeline(id || null);

    if (loading) return <div className="p-8">Loading incident...</div>;
    if (!incident) return <div className="p-8 text-accent">Incident not found</div>;

    const handleEditTitle = async (title: string) => {
        if (!id) return;
        try {
            const incidentRef = doc(db, 'incidents', id);
            await updateDoc(incidentRef, { title });
            setIsEditingTitle(false);
        } catch (err) {
            console.error('Error editing title:', err);
        }
    };

    const handleSendMessage = async (message: string) => {
        if (!id || !user) return;
        try {
            await addDoc(collection(db, 'timeline'), {
                contextId: id,
                type: 'action',
                actorId: user.displayName || user.email?.split('@')[0] || 'Analyst',
                message,
                timestamp: Date.now()
            });
        } catch (err) {
            console.error('Error sending message:', err);
        }
    };

    const handleAddTheory = async (description: string, likelihood: Likelihood) => {
        if (!id || !user) return;
        try {
            const incidentRef = doc(db, 'incidents', id);
            await updateDoc(incidentRef, {
                theories: arrayUnion({
                    id: Math.random().toString(36).substr(2, 9),
                    description,
                    likelihood,
                    authorId: user.uid
                })
            });
        } catch (err) {
            console.error('Error adding theory:', err);
        }
    };

    const handleRemoveTheory = async (theoryId: string) => {
        if (!id || !incident) return;
        const theory = incident.theories.find(t => t.id === theoryId);
        if (!theory) return;

        try {
            const incidentRef = doc(db, 'incidents', id);
            await updateDoc(incidentRef, {
                theories: arrayRemove(theory)
            });
        } catch (err) {
            console.error('Error removing theory:', err);
        }
    };

    const handleEditTheory = async (theoryId: string, description: string, likelihood: Likelihood) => {
        if (!id || !incident) return;
        const theory = incident.theories.find(t => t.id === theoryId);
        if (!theory) return;

        try {
            const incidentRef = doc(db, 'incidents', id);
            await updateDoc(incidentRef, {
                theories: arrayRemove(theory)
            });
            await updateDoc(incidentRef, {
                theories: arrayUnion({
                    ...theory,
                    description,
                    likelihood
                })
            });
        } catch (err) {
            console.error('Error editing theory:', err);
        }
    };

    const handleAddTask = async (description: string) => {
        if (!id) return;
        try {
            const incidentRef = doc(db, 'incidents', id);
            await updateDoc(incidentRef, {
                todo: arrayUnion({
                    id: Math.random().toString(36).substr(2, 9),
                    description,
                    completedAt: null,
                    completedBy: null
                })
            });
        } catch (err) {
            console.error('Error adding task:', err);
        }
    };

    const handleEditTask = async (taskId: string, description: string) => {
        if (!id || !incident) return;
        
        const todoTask = incident.todo?.find(t => t.id === taskId);
        const doneTask = incident.done?.find(t => t.id === taskId);
        const task = todoTask || doneTask;
        
        if (!task) return;

        try {
            const incidentRef = doc(db, 'incidents', id);
            const field = todoTask ? 'todo' : 'done';
            
            await updateDoc(incidentRef, {
                [field]: arrayRemove(task)
            });
            
            await updateDoc(incidentRef, {
                [field]: arrayUnion({
                    ...task,
                    description
                })
            });
        } catch (err) {
            console.error('Error editing task:', err);
        }
    };

    const handleDeleteTask = async (taskId: string) => {
        if (!id || !incident) return;
        
        const todoTask = incident.todo?.find(t => t.id === taskId);
        const doneTask = incident.done?.find(t => t.id === taskId);
        const task = todoTask || doneTask;
        
        if (!task) return;

        try {
            const incidentRef = doc(db, 'incidents', id);
            const field = todoTask ? 'todo' : 'done';
            
            await updateDoc(incidentRef, {
                [field]: arrayRemove(task)
            });
        } catch (err) {
            console.error('Error deleting task:', err);
        }
    };

    const handleToggleTask = async (taskId: string) => {
        if (!id || !incident || !user) return;

        const todoTask = incident.todo?.find(t => t.id === taskId);
        const doneTask = incident.done?.find(t => t.id === taskId);

        try {
            const incidentRef = doc(db, 'incidents', id);
            if (todoTask) {
                // Move from todo to done
                await updateDoc(incidentRef, {
                    todo: arrayRemove(todoTask),
                    done: arrayUnion({
                        ...todoTask,
                        completedAt: Date.now(),
                        completedBy: user.displayName || user.email?.split('@')[0] || 'Analyst'
                    })
                });
            } else if (doneTask) {
                // Move from done to todo
                await updateDoc(incidentRef, {
                    done: arrayRemove(doneTask),
                    todo: arrayUnion({
                        ...doneTask,
                        completedAt: null,
                        completedBy: null
                    })
                });
            }
        } catch (err) {
            console.error('Error toggling task:', err);
        }
    };

    const handleAddHistoricalEvent = async (details: Partial<TimelineEvent>) => {
        if (!id || !user) return;
        try {
            await addDoc(collection(db, 'timeline'), {
                contextId: id,
                type: 'note',
                actorId: user.displayName || user.email?.split('@')[0] || 'Analyst',
                timestamp: Date.now(),
                ...details
            });
        } catch (err) {
            console.error('Error adding historical event:', err);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-background">
            <Header presences={presences} />

            {/* Sub-header */}
            <div className="h-14 border-b border-border bg-surface px-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link 
                        to="/incidents"
                        className="p-2 hover:bg-muted rounded-full transition-colors text-muted hover:text-text"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <div className="space-y-0.5 min-w-[300px]">
                        {isEditingTitle ? (
                            <InlineEdit
                                value={incident.title}
                                onSave={handleEditTitle}
                                onCancel={() => setIsEditingTitle(false)}
                                className="text-lg font-bold font-heading"
                            />
                        ) : (
                            <h1 
                                onClick={() => setIsEditingTitle(true)}
                                className="font-heading font-bold text-lg leading-tight cursor-pointer hover:text-primary transition-colors"
                            >
                                {incident.title}
                            </h1>
                        )}
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

                {/* Linked Alerts */}
                <div className="flex items-center gap-2 px-6 border-l border-border h-full">
                    <span className="text-[10px] text-muted font-bold uppercase tracking-widest mr-2">Linked Alerts:</span>
                    <div className="flex items-center gap-2">
                        {incident.alertIds && incident.alertIds.length > 0 ? (
                            incident.alertIds.map(alertId => (
                                <Link
                                    key={alertId}
                                    to={`/?search=${alertId}`}
                                    className="flex items-center gap-1 bg-muted/20 px-2 py-1 rounded text-[10px] font-mono hover:bg-muted/40 transition-colors"
                                    title={`View Alert ${alertId}`}
                                >
                                    <AlertCircle className="w-3 h-3 text-primary" />
                                    {alertId.substring(0, 8).toUpperCase()}
                                </Link>
                            ))
                        ) : (
                            <span className="text-[10px] text-muted italic">None</span>
                        )}
                    </div>
                </div>
                <button
                    onClick={() => setIsSummaryOpen(true)}
                    className="flex items-center gap-2 bg-primary/5 border border-primary/20 text-primary px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/10 transition-all"
                >
                    <Share2 className="w-4 h-4" />
                    Summarize &amp; Share
                </button>
            </div>

            {/* 4-Quadrant Workspace */}
            <div className="flex-1 p-6 grid grid-cols-2 grid-rows-2 gap-6 overflow-hidden">
                {/* Q1: Timeline */}
                <div className="bg-surface rounded-xl border border-border p-4 shadow-sm flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 text-primary font-heading font-bold uppercase tracking-widest text-xs mb-4">
                        Timeline
                    </div>
                    <LiveTimeline 
                        events={events} 
                        onSendMessage={handleSendMessage} 
                        onOpenEditor={() => setIsEditorOpen(true)}
                    />
                </div>

                {/* Q2: Active Theories */}
                <div className="bg-surface rounded-xl border border-border p-4 shadow-sm overflow-hidden">
                    <TheoryBoard
                        theories={incident.theories || []}
                        onAdd={handleAddTheory}
                        onRemove={handleRemoveTheory}
                        onEdit={handleEditTheory}
                    />
                </div>

                {/* Q3: Actions Taken (HAVEDONE) */}
                <div className="bg-surface rounded-xl border border-border p-4 shadow-sm overflow-hidden">
                    <TaskList
                        title="Actions Taken"
                        type="done"
                        tasks={incident.done || []}
                        onToggle={handleToggleTask}
                        onEdit={handleEditTask}
                        onDelete={handleDeleteTask}
                    />
                </div>

                {/* Q4: Next Steps (TODO) */}
                <div className="bg-surface rounded-xl border border-border p-4 shadow-sm overflow-hidden">
                    <TaskList
                        title="Next Steps"
                        type="todo"
                        tasks={incident.todo || []}
                        onAdd={handleAddTask}
                        onToggle={handleToggleTask}
                        onEdit={handleEditTask}
                        onDelete={handleDeleteTask}
                    />
                </div>
            </div>

            <SummaryModal
                isOpen={isSummaryOpen}
                onClose={() => setIsSummaryOpen(false)}
                markdown={generateMarkdownSummary(incident, events)}
            />

            {isEditorOpen && (
                <TimelineEditor
                    events={events}
                    onUpdateEvent={updateEventDetails}
                    onReorderEvents={reorderEvents}
                    onDeleteEvent={deleteEvent}
                    onAddEvent={handleAddHistoricalEvent}
                    onClose={() => setIsEditorOpen(false)}
                />
            )}
        </div>
    );
};
