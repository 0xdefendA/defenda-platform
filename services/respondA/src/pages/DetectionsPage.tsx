import { useState } from 'react';
import { doc, deleteDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Download, FileCode2, Pencil, Radar, Trash2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { Sidebar } from '../components/layout/Sidebar';
import { SeverityBadge } from '../components/ui/SeverityBadge';
import { RuleEditorModal } from '../components/events/RuleEditorModal';
import { Toast, useToast } from '../components/ui/Toast';
import { useRules } from '../hooks/useRules';
import { yamlField, type RuleDoc } from '../lib/rules';

export const DetectionsPage = () => {
    const { rules, loading } = useRules();
    const [editing, setEditing] = useState<RuleDoc | null>(null);
    const { toast, showToast, clearToast } = useToast();

    const handleToggle = async (rule: RuleDoc) => {
        try {
            await updateDoc(doc(db, 'rules', rule.name), {
                enabled: !rule.enabled,
                updated_at: serverTimestamp(),
            });
        } catch (err) {
            console.error('Error toggling rule:', err);
        }
    };

    const handleDelete = async (rule: RuleDoc) => {
        if (!window.confirm(`Delete rule "${rule.name}"? alertA stops evaluating it within a minute.`)) return;
        try {
            await deleteDoc(doc(db, 'rules', rule.name));
        } catch (err) {
            console.error('Error deleting rule:', err);
        }
    };

    const handleDownload = (rule: RuleDoc) => {
        const blob = new Blob([rule.yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${rule.name}.yml`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const thClass = "px-3 py-2 font-display text-[10px] font-bold text-muted uppercase tracking-widest";

    return (
        <div className="flex h-screen bg-background text-text-main overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="h-[48px] flex items-center gap-3 px-4 border-b border-thin border-border-color bg-surface flex-shrink-0">
                    <h1 className="font-display font-bold text-base text-text-main flex items-center gap-2">
                        <Radar className="w-4 h-4 text-primary" />
                        Detections
                    </h1>
                    <span className="text-xs text-muted">
                        Live rules deployed via Firestore. File-based rules in <span className="font-mono">services/alertA/rules/</span> are managed in git.
                    </span>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    <div className="border border-thin border-border-color bg-surface rounded-lg overflow-hidden">
                        {loading ? (
                            <div className="py-16 text-center text-sm text-muted">Loading rules…</div>
                        ) : rules.length === 0 ? (
                            <div className="flex flex-col items-center justify-center text-muted gap-3 py-16">
                                <FileCode2 className="w-10 h-10 opacity-30" />
                                <p className="text-sm">No live rules yet. Create one from a query on the Events page.</p>
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-thin border-border-color">
                                        <th className={thClass}>Enabled</th>
                                        <th className={thClass}>Name</th>
                                        <th className={thClass}>Type</th>
                                        <th className={thClass}>Severity</th>
                                        <th className={thClass}>Threshold</th>
                                        <th className={thClass}>Created by</th>
                                        <th className={`${thClass} text-right`}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rules.map(rule => {
                                        const severity = rule.draft?.severity || yamlField(rule.yaml, 'severity') || 'INFO';
                                        const alertType = rule.draft?.alert_type || yamlField(rule.yaml, 'alert_type') || 'threshold';
                                        const threshold = alertType === 'sequence'
                                            ? `${rule.draft?.slots?.length ?? '?'} slots`
                                            : rule.draft?.threshold ?? yamlField(rule.yaml, 'threshold') ?? '—';
                                        return (
                                            <tr key={rule.name} className="border-b border-thin border-border-color hover:bg-row-hover transition-colors">
                                                <td className="px-3 py-2">
                                                    <button
                                                        onClick={() => handleToggle(rule)}
                                                        title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                                                        className={`relative w-9 h-5 rounded-full transition-colors ${rule.enabled ? 'bg-primary' : 'bg-border-color'}`}
                                                    >
                                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${rule.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                                                    </button>
                                                </td>
                                                <td className={`px-3 py-2 font-mono text-xs ${rule.enabled ? 'text-text-main' : 'text-muted line-through'}`}>
                                                    {rule.name}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-xs text-muted">{alertType}</td>
                                                <td className="px-3 py-2">
                                                    <SeverityBadge severity={severity.toLowerCase()} />
                                                </td>
                                                <td className="px-3 py-2 font-mono text-xs text-muted">{String(threshold)}</td>
                                                <td className="px-3 py-2 text-xs text-muted">{rule.created_by || '—'}</td>
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            onClick={() => setEditing(rule)}
                                                            title="Edit rule"
                                                            className="p-1.5 rounded text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                                                        >
                                                            <Pencil className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDownload(rule)}
                                                            title="Download YAML (promote to repo)"
                                                            className="p-1.5 rounded text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                                                        >
                                                            <Download className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(rule)}
                                                            title="Delete rule"
                                                            className="p-1.5 rounded text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </main>

            {editing && (
                <RuleEditorModal existing={editing} onClose={() => setEditing(null)} onSaved={showToast} />
            )}

            <Toast message={toast} onDismiss={clearToast} />
        </div>
    );
};
