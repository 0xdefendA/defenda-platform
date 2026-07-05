import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { X, Download, ShieldPlus, Save, Loader2 } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/useAuth';
import {
    generateRuleYaml, isValidRuleName,
    type RuleDoc, type ThresholdRuleDraft,
} from '../../lib/rules';

interface RuleEditorModalProps {
    /** Prefill criteria when creating from the Events page. */
    criteria?: string;
    /** When set, the modal edits this existing Firestore rule. */
    existing?: RuleDoc | null;
    onClose: () => void;
    /** Called after a successful save (e.g. to show a toast). */
    onSaved?: (message: string) => void;
}

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const emptyDraft = (criteria: string): ThresholdRuleDraft => ({
    alert_name: '',
    severity: 'INFO',
    category: 'general',
    criteria,
    summary: '{{metadata.value}} matched {{metadata.count}} times',
    threshold: 1,
    aggregation_key: '',
    event_snippet: '',
    event_sample_count: 3,
    tags: [],
});

export const RuleEditorModal = ({ criteria = '', existing = null, onClose, onSaved }: RuleEditorModalProps) => {
    const { user } = useAuth();
    const isEdit = !!existing;
    // Hand-added Firestore docs have no structured draft → edit raw YAML.
    const rawOnly = isEdit && !existing?.draft;

    const [draft, setDraft] = useState<ThresholdRuleDraft>(
        existing?.draft ? { ...existing.draft } : emptyDraft(criteria)
    );
    const [tagsInput, setTagsInput] = useState(existing?.draft?.tags?.join(', ') ?? '');
    const [rawYaml, setRawYaml] = useState(existing?.yaml ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const set = (patch: Partial<ThresholdRuleDraft>) => {
        setDraft(d => ({ ...d, ...patch }));
    };

    // Close on Escape, like the rest of the app's overlays.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const effectiveDraft = useMemo(
        () => ({ ...draft, tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean) }),
        [draft, tagsInput]
    );

    const yaml = rawOnly ? rawYaml : generateRuleYaml(effectiveDraft);

    const ruleName = isEdit ? existing!.name : draft.alert_name;
    const nameValid = isValidRuleName(ruleName);
    const canSave = rawOnly
        ? rawYaml.trim().length > 0
        : !!(nameValid && draft.criteria.trim() && draft.summary.trim());

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            const ruleRef = doc(db, 'rules', ruleName);
            if (isEdit) {
                await updateDoc(ruleRef, {
                    yaml,
                    ...(rawOnly ? {} : { draft: effectiveDraft }),
                    updated_at: serverTimestamp(),
                });
            } else {
                const existingDoc = await getDoc(ruleRef);
                if (existingDoc.exists()) {
                    setError(`A rule named "${ruleName}" already exists.`);
                    return;
                }
                await setDoc(ruleRef, {
                    name: ruleName,
                    yaml,
                    draft: effectiveDraft,
                    enabled: true,
                    created_by: user?.email || 'unknown',
                    created_at: serverTimestamp(),
                    updated_at: serverTimestamp(),
                });
            }
            onSaved?.(`Rule "${ruleName}" saved — live within a minute.`);
            onClose();
        } catch (err) {
            console.error('Error saving rule:', err);
            setError('Failed to save rule. See console for details.');
        } finally {
            setSaving(false);
        }
    };

    const handleDownload = () => {
        const blob = new Blob([yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${ruleName || 'new_rule'}.yml`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const inputClass = "w-full text-xs bg-background border border-border-color rounded px-2 py-1.5 text-text-main placeholder:text-muted/60";
    const labelClass = "text-[10px] font-display font-bold text-muted uppercase tracking-widest";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div
                className="bg-surface border border-border-color rounded-xl shadow-xl w-[860px] max-w-[95vw] max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-thin border-border-color">
                    <h2 className="font-display font-bold text-base text-text-main flex items-center gap-2">
                        <ShieldPlus className="w-4 h-4 text-primary" />
                        {isEdit ? `Edit Detection Rule: ${existing!.name}` : 'Create Detection Rule from Query'}
                    </h2>
                    <button onClick={onClose} className="text-muted hover:text-text-main">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {rawOnly ? (
                    /* Raw YAML editing for rules without structured form state */
                    <div className="flex flex-col gap-2 p-5 overflow-y-auto">
                        <label className={labelClass}>Rule YAML</label>
                        <textarea
                            value={rawYaml}
                            onChange={(e) => setRawYaml(e.target.value)}
                            rows={18}
                            spellCheck={false}
                            className={`${inputClass} font-mono resize-y`}
                        />
                        <p className="text-[10px] text-muted">
                            This rule has no structured form data (it was added outside the rule editor),
                            so it's edited as raw YAML. alertA picks up changes within a minute.
                        </p>
                    </div>
                ) : (
                    <div className="flex gap-5 p-5 overflow-y-auto">
                        {/* Form */}
                        <div className="flex-1 flex flex-col gap-3 min-w-0">
                            <div>
                                <label className={labelClass}>Rule name</label>
                                <input
                                    value={ruleName}
                                    onChange={(e) => set({ alert_name: e.target.value })}
                                    disabled={isEdit}
                                    placeholder="aws_console_login_burst"
                                    className={`${inputClass} font-mono mt-1 disabled:opacity-60 ${ruleName && !nameValid ? 'border-accent' : ''}`}
                                />
                                {!isEdit && ruleName && !nameValid && (
                                    <p className="text-[10px] text-accent mt-1">Lowercase letters, digits, underscores; 3–64 chars.</p>
                                )}
                            </div>

                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className={labelClass}>Severity</label>
                                    <select
                                        value={draft.severity}
                                        onChange={(e) => set({ severity: e.target.value })}
                                        className={`${inputClass} mt-1`}
                                    >
                                        {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className={labelClass}>Category</label>
                                    <input
                                        value={draft.category}
                                        onChange={(e) => set({ category: e.target.value })}
                                        placeholder="authentication"
                                        className={`${inputClass} mt-1`}
                                    />
                                </div>
                                <div className="w-24">
                                    <label className={labelClass}>Threshold</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={draft.threshold}
                                        onChange={(e) => set({ threshold: Number(e.target.value) })}
                                        className={`${inputClass} mt-1`}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className={labelClass}>Criteria</label>
                                <textarea
                                    value={draft.criteria}
                                    onChange={(e) => set({ criteria: e.target.value })}
                                    rows={3}
                                    spellCheck={false}
                                    className={`${inputClass} font-mono mt-1 resize-y`}
                                />
                            </div>

                            <div>
                                <label className={labelClass}>Aggregation key</label>
                                <input
                                    value={draft.aggregation_key}
                                    onChange={(e) => set({ aggregation_key: e.target.value })}
                                    placeholder="details.useridentity.arn (optional — groups events before counting)"
                                    className={`${inputClass} font-mono mt-1`}
                                />
                            </div>

                            <div>
                                <label className={labelClass}>Summary template</label>
                                <input
                                    value={draft.summary}
                                    onChange={(e) => set({ summary: e.target.value })}
                                    className={`${inputClass} font-mono mt-1`}
                                />
                                <p className="text-[10px] text-muted mt-1">
                                    {'{{metadata.value}}'} = aggregation value, {'{{metadata.count}}'} = event count.
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className={labelClass}>Event snippet (optional)</label>
                                    <input
                                        value={draft.event_snippet}
                                        onChange={(e) => set({ event_snippet: e.target.value })}
                                        placeholder="{{details.sourceipaddress}} → {{details.eventname}}"
                                        className={`${inputClass} font-mono mt-1`}
                                    />
                                </div>
                                <div className="w-24">
                                    <label className={labelClass}>Samples</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={draft.event_sample_count}
                                        onChange={(e) => set({ event_sample_count: Number(e.target.value) })}
                                        className={`${inputClass} mt-1`}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className={labelClass}>Tags (comma-separated)</label>
                                <input
                                    value={tagsInput}
                                    onChange={(e) => setTagsInput(e.target.value)}
                                    placeholder="aws, login"
                                    className={`${inputClass} mt-1`}
                                />
                            </div>
                        </div>

                        {/* YAML preview */}
                        <div className="w-[340px] flex-shrink-0 flex flex-col">
                            <label className={labelClass}>Rule YAML</label>
                            <pre className="flex-1 mt-1 text-[11px] font-mono text-text-main whitespace-pre-wrap break-all bg-background border border-thin border-border-color rounded p-3 overflow-auto">
                                {yaml}
                            </pre>
                            <p className="text-[10px] text-muted mt-2 leading-relaxed">
                                Saving deploys this rule live via Firestore — alertA evaluates it within a minute.
                                Download the YAML to promote it into <span className="font-mono">services/alertA/rules/</span> under code review.
                            </p>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center gap-3 px-5 py-3 border-t border-thin border-border-color">
                    {error && <span className="text-xs text-accent">{error}</span>}
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            onClick={handleDownload}
                            disabled={!nameValid}
                            className="flex items-center gap-2 border border-border-color text-text-main py-1.5 px-4 rounded-lg text-xs font-bold hover:bg-row-hover transition-all disabled:opacity-40"
                        >
                            <Download className="w-4 h-4" /> Download YAML
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!canSave || saving}
                            className="flex items-center gap-2 bg-primary text-white py-1.5 px-4 rounded-lg text-xs font-bold hover:bg-primary/90 transition-all shadow-sm shadow-primary/20 disabled:opacity-40"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? <Save className="w-4 h-4" /> : <ShieldPlus className="w-4 h-4" />}
                            {isEdit ? 'Save Changes' : 'Save & Deploy'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
