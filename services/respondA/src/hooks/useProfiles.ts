import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AVATAR_COLORS, type UserProfile } from './useProfile';

/**
 * Streams every analyst profile (users collection) as a uid → profile map,
 * so assignee bubbles and avatars can render chosen names/photos/colors.
 */
export const useProfiles = () => {
    const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());

    useEffect(() => {
        const unsubscribe = onSnapshot(
            collection(db, 'users'),
            (snapshot) => {
                const next = new Map<string, UserProfile>();
                snapshot.forEach((doc) => {
                    const data = doc.data();
                    next.set(doc.id, {
                        uid: doc.id,
                        displayName: data.displayName || data.email?.split('@')[0] || 'Analyst',
                        title: data.title || 'Analyst',
                        photoURL: data.photoURL || '',
                        avatarColor: data.avatarColor || AVATAR_COLORS[0],
                    });
                });
                setProfiles(next);
            },
            (err) => console.error('Error fetching profiles:', err)
        );
        return () => unsubscribe();
    }, []);

    return { profiles };
};
