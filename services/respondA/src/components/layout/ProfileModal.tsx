import { useEffect, useState } from 'react';
import { X, Save, Loader2, UserRound } from 'lucide-react';
import { AVATAR_COLORS, initialsFor, type UserProfile } from '../../hooks/useProfile';

interface ProfileModalProps {
    profile: UserProfile;
    onSave: (patch: Pick<UserProfile, 'displayName' | 'title' | 'photoURL' | 'avatarColor'>) => Promise<void>;
    onClose: () => void;
}

export const ProfileModal = ({ profile, onSave, onClose }: ProfileModalProps) => {
    const [displayName, setDisplayName] = useState(profile.displayName);
    const [title, setTitle] = useState(profile.title);
    const [photoURL, setPhotoURL] = useState(profile.photoURL);
    const [avatarColor, setAvatarColor] = useState(profile.avatarColor);
    const [photoBroken, setPhotoBroken] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const canSave = displayName.trim().length > 0 && !saving;

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            await onSave({
                displayName: displayName.trim(),
                title: title.trim() || 'Analyst',
                photoURL: photoURL.trim(),
                avatarColor,
            });
            onClose();
        } catch (err) {
            console.error('Error saving profile:', err);
            setError('Failed to save profile. See console for details.');
        } finally {
            setSaving(false);
        }
    };

    const inputClass = "w-full text-xs bg-background border border-border-color rounded px-2 py-1.5 text-text-main placeholder:text-muted/60";
    const labelClass = "text-[10px] font-display font-bold text-muted uppercase tracking-widest";

    const showPhoto = photoURL.trim() && !photoBroken;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div
                className="bg-surface border border-border-color rounded-xl shadow-xl w-[420px] max-w-[95vw] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-thin border-border-color">
                    <h2 className="font-display font-bold text-base text-text-main flex items-center gap-2">
                        <UserRound className="w-4 h-4 text-primary" />
                        Edit Profile
                    </h2>
                    <button onClick={onClose} className="text-muted hover:text-text-main">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex flex-col gap-3 p-5">
                    {/* Preview */}
                    <div className="flex items-center gap-3">
                        <div
                            className="w-14 h-14 rounded-full border-2 border-primary overflow-hidden flex items-center justify-center text-sm font-mono font-bold text-white shrink-0"
                            style={{ backgroundColor: showPhoto ? undefined : avatarColor }}
                        >
                            {showPhoto ? (
                                <img
                                    alt="Avatar preview"
                                    src={photoURL}
                                    className="w-full h-full object-cover"
                                    onError={() => setPhotoBroken(true)}
                                />
                            ) : (
                                initialsFor(displayName)
                            )}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-medium text-text-main">{displayName.trim() || 'Analyst'}</span>
                            <span className="text-xs text-muted font-mono">{title.trim() || 'Analyst'}</span>
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>Display name</label>
                        <input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className={`${inputClass} mt-1`}
                        />
                    </div>

                    <div>
                        <label className={labelClass}>Title</label>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Tier 2 Analyst"
                            className={`${inputClass} mt-1`}
                        />
                    </div>

                    <div>
                        <label className={labelClass}>Photo URL (optional)</label>
                        <input
                            value={photoURL}
                            onChange={(e) => { setPhotoURL(e.target.value); setPhotoBroken(false); }}
                            placeholder="https://github.com/you.png"
                            className={`${inputClass} font-mono mt-1`}
                        />
                        {photoBroken && photoURL.trim() && (
                            <p className="text-[10px] text-accent mt-1">Couldn't load that image — falling back to initials.</p>
                        )}
                    </div>

                    <div>
                        <label className={labelClass}>Accent color (initials fallback)</label>
                        <div className="flex gap-2 mt-1.5">
                            {AVATAR_COLORS.map(color => (
                                <button
                                    key={color}
                                    onClick={() => setAvatarColor(color)}
                                    title={color}
                                    className={`w-6 h-6 rounded-full transition-transform ${avatarColor === color ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-110'}`}
                                    style={{ backgroundColor: color }}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 px-5 py-3 border-t border-thin border-border-color">
                    {error && <span className="text-xs text-accent">{error}</span>}
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="border border-border-color text-text-main py-1.5 px-4 rounded-lg text-xs font-bold hover:bg-row-hover transition-all"
                        >
                            Cancel
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
            </div>
        </div>
    );
};
