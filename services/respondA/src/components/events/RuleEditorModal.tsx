import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { X, Download, ShieldPlus, Save, Loader2, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../hooks/useAuth';
import {
    emptySlot, generateRuleYaml, isValidRuleName,
    type RuleAlertType, type RuleDoc, type SequenceSlotDraft, type ThresholdRuleDraft,
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
    alert_type: 'threshold',
    severity: 'INFO',
    category: 'general',
    criteria,
    summary: '{{metadata.value}} matched {{metadata.count}} times',
    threshold: 1,
    aggregation_key: '',
    event_snippet: '',
    event_sample_count: 3,
    tags: [],
    lookback_minutes: 5,
});

const TYPE_HELP: Record<RuleAlertType, string> = {
    threshold: 'Threshold: fires when count ≥ threshold within the lookback window, grouped by the aggregation key.',
    deadman: 'Deadman: fires when matching events are MISSING — count ≤ threshold within the lookback window (0 = expected events stopped arriving). Repeat triggers fold into the open alert as hits.',
    sequence: 'Sequence: all slots must trigger in order within the lifespan. Later slots can reference earlier ones, e.g. {{slots.0.events.0.details.user_name}}.',
};

export const RuleEditorModal = ({ criteria = '', existing = null, onClose, onSaved }: RuleEditorModalProps) => {
    const { user } = useAuth();
    const isEdit = !!existing;
    // Hand-added Firestore docs have no structured draft → edit raw YAML.
    const rawOnly = isEdit && !existing?.draft;

    const [draft, setDraft] = useState<ThresholdRuleDraft>(
        existing?.draft
            // Drafts saved before the type selector existed default to threshold.
            ? { ...existing.draft, alert_type: existing.draft.alert_type ?? 'threshold' }
            : emptyDraft(criteria)
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
    const isSequence = draft.alert_type === 'sequence';
    const slots = draft.slots ?? [];
    const canSave = rawOnly
        ? rawYaml.trim().length > 0
        : isSequence
            ? !!(nameValid && draft.summary.trim() && slots.length >= 2 && slots.every(s => s.criteria.trim()))
            : !!(nameValid && draft.criteria.trim() && draft.summary.trim());

    const handleTypeChange = (t: RuleAlertType) => {
        if (t === 'sequence' && slots.length === 0) {
            // Seed slot 0 from the current criteria so nothing typed is lost.
            set({
                alert_type: t,
                lifespan_days: draft.lifespan_days ?? 7,
                slots: [emptySlot(draft.criteria), emptySlot()],
            });
        } else {
            set({ alert_type: t });
        }
    };

    const updateSlot = (index: number, patch: Partial<SequenceSlotDraft>) => {
        set({ slots: slots.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
    };

    const moveSlot = (index: number, delta: -1 | 1) => {
        const target = index + delta;
        if (target < 0 || target >= slots.length) return;
        const next = [...slots];
        [next[index], next[target]] = [next[target], next[index]];
        set({ slots: next });
    };

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
                                    <label className={labelClass}>Type</label>
                                    <select
                                        value={draft.alert_type}
                                        onChange={(e) => handleTypeChange(e.target.value as RuleAlertType)}
                                        className={`${inputClass} mt-1`}
                                    >
                                        <option value="threshold">threshold</option>
                                        <option value="deadman">deadman</option>
                                        <option value="sequence">sequence</option>
                                    </select>
                                </div>
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
                                {isSequence ? (
                                    <div className="w-28">
                                        <label className={labelClass}>Lifespan (days)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={draft.lifespan_days ?? 7}
                                            onChange={(e) => set({ lifespan_days: Number(e.target.value) })}
                                            className={`${inputClass} mt-1`}
                                        />
                                    </div>
                                ) : (
                                    <div className="w-24">
                                        <label className={labelClass}>Threshold</label>
                                        <input
                                            type="number"
                                            min={draft.alert_type === 'deadman' ? 0 : 1}
                                            value={draft.threshold}
                                            onChange={(e) => set({ threshold: Number(e.target.value) })}
                                            className={`${inputClass} mt-1`}
                                        />
                                    </div>
                                )}
                                {draft.alert_type === 'deadman' && (
                                    <div className="w-28">
                                        <label className={labelClass}>Lookback (min)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={draft.lookback_minutes ?? 5}
                                            onChange={(e) => set({ lookback_minutes: Number(e.target.value) })}
                                            className={`${inputClass} mt-1`}
                                        />
                                    </div>
                                )}
                            </div>
                            <p className="text-[10px] text-muted -mt-1">{TYPE_HELP[draft.alert_type]}</p>

                            {isSequence ? (
                                <div className="flex flex-col gap-2">
                                    <label className={labelClass}>Slots (all must trigger, in order)</label>
                                    {slots.map((slot, i) => (
                                        <div key={i} className="border border-thin border-border-color rounded-lg p-3 flex flex-col gap-2 bg-background/50">
                                            <div className="flex items-center">
                                                <span className="text-[10px] font-display font-bold text-primary uppercase tracking-widest">Slot {i + 1}</span>
                                                <div className="ml-auto flex items-center gap-1">
                                                    <button onClick={() => moveSlot(i, -1)} disabled={i === 0} title="Move up" className="p-1 text-muted hover:text-text-main disabled:opacity-30">
                                                        <ArrowUp className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button onClick={() => moveSlot(i, 1)} disabled={i === slots.length - 1} title="Move down" className="p-1 text-muted hover:text-text-main disabled:opacity-30">
                                                        <ArrowDown className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => set({ slots: slots.filter((_, idx) => idx !== i) })}
                                                        disabled={slots.length <= 2}
                                                        title={slots.length <= 2 ? 'Sequences need at least two slots' : 'Remove slot'}
                                                        className="p-1 text-muted hover:text-accent disabled:opacity-30"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                            <textarea
                                                value={slot.criteria}
                                                onChange={(e) => updateSlot(i, { criteria: e.target.value })}
                                                rows={2}
                                                spellCheck={false}
                                                placeholder={i === 0
                                                    ? "source='onelogin' AND CAST(JSON_VALUE(details.risk_score) AS INT64) > 80"
                                                    : "… AND JSON_VALUE(details.user_name) = '{{slots.0.events.0.details.user_name}}'"}
                                                className={`${inputClass} font-mono resize-y`}
                                            />
                                            <div className="flex gap-2">
                                                <input
                                                    value={slot.aggregation_key}
                                                    onChange={(e) => updateSlot(i, { aggregation_key: e.target.value })}
                                                    placeholder="aggregation key (optional)"
                                                    className={`${inputClass} font-mono flex-1`}
                                                />
                                                <div className="flex items-center gap-1 w-32">
                                                    <span className="text-[10px] text-muted uppercase font-bold">≥</span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={slot.threshold}
                                                        onChange={(e) => updateSlot(i, { threshold: Number(e.target.value) })}
                                                        title="Slot threshold"
                                                        className={inputClass}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => set({ slots: [...slots, emptySlot()] })}
                                        className="self-start flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                                    >
                                        <Plus className="w-3 h-3" /> Add slot
                                    </button>
                                </div>
                            ) : (
                                <>
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
                                </>
                            )}

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

                            {!isSequence && (
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
                            )}

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
