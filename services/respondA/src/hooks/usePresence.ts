import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, setDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './useAuth';
import { useProfile } from './useProfile';
import type { Presence } from '../types';

// Browsers heavily throttle timers in background tabs (Chrome to ~1/minute,
// Firefox via budget throttling), so heartbeats from hidden tabs are
// unreliable. Presence therefore treats DOC EXISTENCE as "here": departure
// is the explicit delete on unmount/pagehide, and the stale cutoff is only
// garbage collection for crashed sessions — generous enough that throttled
// background heartbeats always land within it.
const STALE_MS = 600_000;    // GC after 10min without any heartbeat (crash/kill)
const HEARTBEAT_MS = 60_000; // refresh lastActive every minute
const TICK_MS = 30_000;      // re-evaluate staleness locally even without snapshots

/**
 * Publishes this analyst's presence for a context (screen/alert/incident)
 * and streams OTHER analysts active in the same context.
 *
 * Robustness notes:
 * - presence/{uid} is a single doc per analyst; navigating just repoints it.
 * - Immediate write on mount/context change (no throttle), then a heartbeat.
 * - Departure = explicit delete on unmount/pagehide, with the staleness
 *   filter as the safety net for crashes and lost connections.
 * - Returned presences EXCLUDE self — "who else is here".
 */
export const usePresence = (contextId: string | null) => {
    const { user } = useAuth();
    const { profile } = useProfile();
    const [rawPresences, setRawPresences] = useState<Presence[]>([]);
    const [now, setNow] = useState(Date.now());

    const currentUser = useMemo(() => ({
        id: user?.uid ?? 'anonymous',
        name: profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Analyst',
        avatarColor: profile?.avatarColor || '#0d59f2',
        photoURL: profile?.photoURL || user?.photoURL || null,
    }), [user, profile]);

    // 1. Subscribe to presence in this context
    useEffect(() => {
        if (!contextId) {
            setRawPresences([]);
            return;
        }
        const q = query(
            collection(db, 'presence'),
            where('activeContextId', '==', contextId)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data: Presence[] = [];
            snapshot.forEach((doc) => data.push(doc.data() as Presence));
            setRawPresences(data);
        });
        return () => unsubscribe();
    }, [contextId]);

    // 2. Local clock so analysts who stop heartbeating disappear even if no
    //    new snapshot arrives to trigger a re-filter.
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(timer);
    }, []);

    // 3. Publish own presence: write immediately, then heartbeat.
    useEffect(() => {
        if (!contextId || !user) return;
        const presenceRef = doc(db, 'presence', user.uid);

        const write = () =>
            setDoc(presenceRef, {
                userId: user.uid,
                userName: currentUser.name,
                userColor: currentUser.avatarColor,
                userPhoto: currentUser.photoURL,
                activeContextId: contextId,
                lastActive: serverTimestamp(),
            }, { merge: true }).catch((err) => console.error('Presence write failed:', err));

        write();
        const heartbeat = setInterval(write, HEARTBEAT_MS);

        // Write on both hide and show: a fresh timestamp when backgrounding
        // buys the full stale window even if throttled heartbeats never fire,
        // and returning to the tab refreshes immediately.
        const onVisible = () => write();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);

        // Best-effort cleanup when the tab closes; staleness covers the rest.
        const onPageHide = () => { deleteDoc(presenceRef).catch(() => { }); };
        window.addEventListener('pagehide', onPageHide);

        return () => {
            clearInterval(heartbeat);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
            window.removeEventListener('pagehide', onPageHide);
            // On context change the next effect run rewrites immediately, so
            // this delete never leaves a lasting gap.
            deleteDoc(presenceRef).catch(() => { });
        };
    }, [contextId, user, currentUser]);

    // Other analysts only, fresh only.
    const presences = useMemo(() => rawPresences.filter(p => {
        if (p.userId === user?.uid) return false;
        const lastActiveVal = p.lastActive as any;
        const lastActive = lastActiveVal?.toMillis
            ? lastActiveVal.toMillis()
            : (typeof lastActiveVal === 'number' ? lastActiveVal : 0);
        return now - lastActive < STALE_MS;
    }), [rawPresences, user, now]);

    return { presences, currentUser };
};
