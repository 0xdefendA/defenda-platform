import { useState } from 'react';
import { Plus, Trash2, BrainCircuit } from 'lucide-react';
import type { Theory, Likelihood } from '../../types';

interface TheoryBoardProps {
    theories: Theory[];
    onAdd: (description: string, likelihood: Likelihood) => void;
    onRemove: (id: string) => void;
}

export const TheoryBoard = ({ theories, onAdd, onRemove }: TheoryBoardProps) => {
    const [newTheory, setNewTheory] = useState('');
    const [likelihood, setLikelihood] = useState<Likelihood>('medium');

    const handleAdd = () => {
        if (!newTheory.trim()) return;
        onAdd(newTheory, likelihood);
        setNewTheory('');
    };

    return (
        <div className="h-full flex flex-col space-y-4">
            <div className="flex items-center gap-2 text-primary font-heading font-bold uppercase tracking-widest text-xs">
                <BrainCircuit className="w-4 h-4" />
                Active Theories
            </div>

            <div className="flex-1 overflow-auto space-y-3 pr-2">
                {theories.map((theory) => (
                    <div key={theory.id} className="p-3 rounded-lg border border-border bg-surface shadow-sm group relative">
                        <div className="flex justify-between items-start gap-2">
                            <p className="text-sm leading-relaxed">{theory.description}</p>
                            <button
                                onClick={() => onRemove(theory.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-accent transition-all"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-tighter
                ${theory.likelihood === 'high' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' :
                                    theory.likelihood === 'medium' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                                        'bg-success/10 text-success border-success/20'}`}>
                                {theory.likelihood} Likelihood
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="pt-2 border-t border-border space-y-2">
                <textarea
                    value={newTheory}
                    onChange={(e) => setNewTheory(e.target.value)}
                    placeholder="New hypothesis..."
                    className="w-full p-2 text-sm bg-muted/20 border border-border rounded-lg focus:ring-1 focus:ring-primary outline-none resize-none h-16"
                />
                <div className="flex justify-between gap-2">
                    <select
                        value={likelihood}
                        onChange={(e) => setLikelihood(e.target.value as Likelihood)}
                        className="text-[10px] bg-surface border border-border rounded px-2 outline-none"
                    >
                        <option value="high">High Likelihood</option>
                        <option value="medium">Medium Likelihood</option>
                        <option value="low">Low Likelihood</option>
                    </select>
                    <button
                        onClick={handleAdd}
                        className="bg-primary text-white p-1.5 rounded-lg hover:bg-primary/90 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};
