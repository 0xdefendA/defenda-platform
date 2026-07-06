import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { useAuth } from './useAuth';

/** Analyst profile stored in Firestore users/{uid} (readable by all analysts). */
export interface UserProfile {
    uid: string;
    displayName: string;
    title: string;
    photoURL: string;
    avatarColor: string;
}

export const AVATAR_COLORS = [
    '#0d59f2', // brand blue
    '#0ca678', // teal
    '#f59f00', // amber
    '#e8590c', // orange
    '#c2255c', // magenta
    '#6741d9', // violet
    '#2f9e44', // green
    '#495057', // slate
];

export const initialsFor = (name: string): string =>
    name
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(p => p[0])
        .join('')
        .toUpperCase() || '??';

/** Streams the signed-in analyst's profile and provides the save path. */
export const useProfile = () => {
    const { user } = useAuth();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setProfile(null);
            setLoading(false);
            return;
        }
        const unsubscribe = onSnapshot(
            doc(db, 'users', user.uid),
            (snapshot) => {
                const data = snapshot.data();
                setProfile({
                    uid: user.uid,
                    displayName: data?.displayName || user.displayName || user.email?.split('@')[0] || 'Analyst',
                    title: data?.title || 'Analyst',
                    photoURL: data?.photoURL || user.photoURL || '',
                    avatarColor: data?.avatarColor || AVATAR_COLORS[0],
                });
                setLoading(false);
            },
            (err) => {
                console.error('Error fetching profile:', err);
                setLoading(false);
            }
        );
        return () => unsubscribe();
    }, [user]);

    const saveProfile = async (patch: Pick<UserProfile, 'displayName' | 'title' | 'photoURL' | 'avatarColor'>) => {
        if (!user) throw new Error('Not signed in');
        await setDoc(
            doc(db, 'users', user.uid),
            { ...patch, email: user.email, updated_at: serverTimestamp() },
            { merge: true }
        );
        // Mirror into Firebase Auth so non-profile-aware code paths
        // (assigneeName on claim, presence, etc.) see the same identity.
        if (auth.currentUser) {
            await updateProfile(auth.currentUser, {
                displayName: patch.displayName,
                photoURL: patch.photoURL || null,
            });
        }
    };

    return { profile, loading, saveProfile };
};
