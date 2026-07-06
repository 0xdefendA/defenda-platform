import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { BellRing, Loader2, Save, Send, Settings as SettingsIcon } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { Sidebar } from '../components/layout/Sidebar';
import { Toast, useToast } from '../components/ui/Toast';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const DEFAULT_TEMPLATE = JSON.stringify(
    {
        blocks: [
            { type: 'header', text: { type: 'plain_text', text: '{{severity}}: {{alert_name}}' } },
            { type: 'section', text: { type: 'mrkdwn', text: '{{summary}}' } },
            {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: 'category: {{category}} · alert {{alert_id}}' }],
            },
        ],
    },
    null,
    2
);

const TEMPLATE_FIELDS = [
    '{{alert_name}}', '{{severity}}', '{{summary}}', '{{category}}',
    '{{alert_id}}', '{{metadata.value}}', '{{metadata.count}}',
];

export const SettingsPage = () => {
    const { user } = useAuth();
    const { toast, showToast, clearToast } = useToast();

    const [enabled, setEnabled] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [minSeverity, setMinSeverity] = useState('HIGH');
    const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getDoc(doc(db, 'settings', 'notifications'))
            .then((snapshot) => {
                const data = snapshot.data();
                if (data) {
                    setEnabled(!!data.enabled);
                    setWebhookUrl(data.webhook_url || '');
                    setMinSeverity(data.min_severity || 'HIGH');
                    setTemplate(data.template || DEFAULT_TEMPLATE);
                }
            })
            .catch((err) => console.error('Error loading settings:', err))
            .finally(() => setLoading(false));
    }, []);

    const templateError = (() => {
        if (!template.trim()) return null;
        try {
            JSON.parse(template);
            return null;
        } catch (err) {
            return err instanceof Error ? err.message : 'Invalid JSON';
        }
    })();

    const webhookLooksValid = webhookUrl.trim() === '' || webhookUrl.startsWith('https://hooks.slack.com/');
    const canSave = !saving && !templateError && (!enabled || (webhookUrl.trim() !== '' && webhookLooksValid));

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            await setDoc(doc(db, 'settings', 'notifications'), {
                enabled,
                webhook_url: webhookUrl.trim(),
                min_severity: minSeverity,
                template,
                updated_by: user?.email || 'unknown',
                updated_at: serverTimestamp(),
            });
            showToast('Notification settings saved.');
        } catch (err) {
            console.error('Error saving settings:', err);
            setError('Failed to save settings. See console for details.');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        if (!webhookUrl.trim()) return;
        try {
            // Slack webhooks don't speak CORS; no-cors + text/plain is the
            // standard fire-and-forget path from a browser. The response is
            // opaque, so confirmation is "check the channel".
            await fetch(webhookUrl.trim(), {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    text: `respondA test notification — sent by ${user?.email || 'an analyst'}`,
                }),
            });
            showToast('Test sent — check your Slack channel.');
        } catch (err) {
            console.error('Test notification failed:', err);
            setError('Test send failed. See console for details.');
        }
    };

    const inputClass = "w-full text-xs bg-background border border-border-color rounded px-2 py-1.5 text-text-main placeholder:text-muted/60";
    const labelClass = "text-[10px] font-display font-bold text-muted uppercase tracking-widest";

    return (
        <div className="flex h-screen bg-background text-text-main overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="h-[48px] flex items-center gap-3 px-4 border-b border-thin border-border-color bg-surface flex-shrink-0">
                    <h1 className="font-display font-bold text-base text-text-main flex items-center gap-2">
                        <SettingsIcon className="w-4 h-4 text-primary" />
                        Settings
                    </h1>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    <div className="max-w-[720px] border border-thin border-border-color bg-surface rounded-lg p-5 flex flex-col gap-4">
                        <h2 className="font-display font-bold text-sm text-text-main flex items-center gap-2">
                            <BellRing className="w-4 h-4 text-primary" />
                            Slack Notifications
                        </h2>
                        <p className="text-xs text-muted -mt-2">
                            alertA posts newly created alerts (first deadman hit, completed sequences) to
                            this webhook when they meet the severity threshold.
                        </p>

                        {loading ? (
                            <div className="py-10 text-center text-sm text-muted">Loading…</div>
                        ) : (
                            <>
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <button
                                        onClick={() => setEnabled(e => !e)}
                                        role="switch"
                                        aria-checked={enabled}
                                        className={`relative w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-border-color'}`}
                                    >
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
                                    </button>
                                    <span className="text-xs font-medium text-text-main">Send Slack notifications</span>
                                </label>

                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className={labelClass}>Webhook URL</label>
                                        <input
                                            value={webhookUrl}
                                            onChange={(e) => setWebhookUrl(e.target.value)}
                                            placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
                                            spellCheck={false}
                                            className={`${inputClass} font-mono mt-1 ${!webhookLooksValid ? 'border-accent' : ''}`}
                                        />
                                        {!webhookLooksValid && (
                                            <p className="text-[10px] text-accent mt-1">Expected an https://hooks.slack.com/ URL.</p>
                                        )}
                                    </div>
                                    <div className="w-40">
                                        <label className={labelClass}>Minimum severity</label>
                                        <select
                                            value={minSeverity}
                                            onChange={(e) => setMinSeverity(e.target.value)}
                                            className={`${inputClass} mt-1`}
                                        >
                                            {SEVERITIES.map(s => <option key={s} value={s}>{s} and above</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className={labelClass}>Message template (Slack Block Kit JSON)</label>
                                    <textarea
                                        value={template}
                                        onChange={(e) => setTemplate(e.target.value)}
                                        rows={12}
                                        spellCheck={false}
                                        className={`${inputClass} font-mono mt-1 resize-y ${templateError ? 'border-accent' : ''}`}
                                    />
                                    {templateError ? (
                                        <p className="text-[10px] text-accent mt-1">Invalid JSON: {templateError}</p>
                                    ) : (
                                        <p className="text-[10px] text-muted mt-1">
                                            Alert fields render via {'{{…}}'}: {TEMPLATE_FIELDS.join('  ')}
                                        </p>
                                    )}
                                    <button
                                        onClick={() => setTemplate(DEFAULT_TEMPLATE)}
                                        className="text-[10px] text-primary hover:underline font-bold uppercase mt-1"
                                    >
                                        Reset to default template
                                    </button>
                                </div>

                                <div className="flex items-center gap-3 pt-2 border-t border-thin border-border-color">
                                    {error && <span className="text-xs text-accent">{error}</span>}
                                    <div className="ml-auto flex items-center gap-2">
                                        <button
                                            onClick={handleTest}
                                            disabled={!webhookUrl.trim() || !webhookLooksValid}
                                            className="flex items-center gap-2 border border-border-color text-text-main py-1.5 px-4 rounded-lg text-xs font-bold hover:bg-row-hover transition-all disabled:opacity-40"
                                        >
                                            <Send className="w-4 h-4" /> Send test
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            disabled={!canSave}
                                            className="flex items-center gap-2 bg-primary text-white py-1.5 px-4 rounded-lg text-xs font-bold hover:bg-primary/90 transition-all shadow-sm shadow-primary/20 disabled:opacity-40"
                                        >
                                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                            Save
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </main>

            <Toast message={toast} onDismiss={clearToast} />
        </div>
    );
};
