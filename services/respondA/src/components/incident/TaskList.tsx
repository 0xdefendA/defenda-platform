import { CheckCircle2, Circle, Plus, ListTodo, ClipboardCheck, Pencil, Trash2 } from 'lucide-react';
import type { Task } from '../../types';
import { useState } from 'react';
import { InlineEdit } from '../ui/InlineEdit';

interface TaskListProps {
    title: string;
    type: 'todo' | 'done';
    tasks: Task[];
    onAdd?: (description: string) => void;
    onToggle?: (id: string) => void;
    onEdit?: (id: string, description: string) => void;
    onDelete?: (id: string) => void;
}

export const TaskList = ({ title, type, tasks, onAdd, onToggle, onEdit, onDelete }: TaskListProps) => {
    const [newTask, setNewTask] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);

    const handleAdd = () => {
        if (!newTask.trim() || !onAdd) return;
        onAdd(newTask);
        setNewTask('');
    };

    return (
        <div className="h-full flex flex-col space-y-4">
            <div className="flex items-center gap-2 text-primary font-heading font-bold uppercase tracking-widest text-xs">
                {type === 'todo' ? <ListTodo className="w-4 h-4" /> : <ClipboardCheck className="w-4 h-4 text-success" />}
                {title}
            </div>

            <div className="flex-1 overflow-auto space-y-2 pr-2">
                {tasks.map((task) => (
                    <div
                        key={task.id}
                        className={`flex items-start gap-3 p-2 rounded-lg border border-border group transition-all
              ${type === 'done' ? 'bg-muted/5 opacity-60' : 'bg-surface hover:border-primary/50'}`}
                    >
                        <div 
                            onClick={() => onToggle?.(task.id)}
                            className={type === 'todo' ? 'cursor-pointer' : ''}
                        >
                            {type === 'todo' ? (
                                <Circle className="w-4 h-4 mt-0.5 text-muted shrink-0 group-hover:text-primary transition-colors" />
                            ) : (
                                <CheckCircle2 className="w-4 h-4 mt-0.5 text-success shrink-0" />
                            )}
                        </div>
                        
                        <div className="flex-1 space-y-1">
                            {editingId === task.id ? (
                                <InlineEdit
                                    value={task.description}
                                    onSave={(val) => {
                                        onEdit?.(task.id, val);
                                        setEditingId(null);
                                    }}
                                    onCancel={() => setEditingId(null)}
                                    className="text-sm"
                                />
                            ) : (
                                <>
                                    <p className={`text-sm ${type === 'done' ? 'line-through' : ''}`}>
                                        {task.description}
                                    </p>
                                    {task.completedBy && (
                                        <p className="text-[10px] text-muted font-mono">
                                            {task.completedBy}
                                        </p>
                                    )}
                                </>
                            )}
                        </div>

                        {editingId !== task.id && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingId(task.id);
                                    }}
                                    className="p-1 hover:bg-muted rounded text-muted hover:text-text transition-colors"
                                    title="Edit task"
                                >
                                    <Pencil size={12} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Are you sure you want to delete this task?')) {
                                            onDelete?.(task.id);
                                        }
                                    }}
                                    className="p-1 hover:bg-destructive/10 rounded text-muted hover:text-destructive transition-colors"
                                    title="Delete task"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {type === 'todo' && onAdd && (
                <div className="pt-2 border-t border-border flex gap-2">
                    <input
                        type="text"
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        placeholder="Add task..."
                        className="flex-1 p-2 text-sm bg-muted/20 border border-border rounded-lg focus:ring-1 focus:ring-primary outline-none"
                    />
                    <button
                        onClick={handleAdd}
                        className="bg-primary text-white p-2 rounded-lg hover:bg-primary/90 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
};
