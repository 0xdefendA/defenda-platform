import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { HuntReport, HuntVerdict } from '../types';

const PAGE_SIZE = 50;

/**
 * Streams hunt_reports newest-first with "load more" pagination and an optional
 * server-side verdict filter — same pattern as useAlerts. Verdict is filtered in
 * the query (not client-side) so "Findings only" isn't limited to whatever
 * happens to be in the loaded window; findings are sparse.
 */
export const useHunts = (verdict: HuntVerdict | null = null, pageSize = PAGE_SIZE) => {
    const [hunts, setHunts] = useState<HuntReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [maxHunts, setMaxHunts] = useState(pageSize);
    const [hasMore, setHasMore] = useState(false);

    // Reset pagination when the verdict filter changes.
    useEffect(() => {
        setMaxHunts(pageSize);
    }, [verdict, pageSize]);

    useEffect(() => {
        const base = collection(db, 'hunt_reports');
        const q = verdict
            ? query(base, where('verdict', '==', verdict), orderBy('created_at', 'desc'), limit(maxHunts))
            : query(base, orderBy('created_at', 'desc'), limit(maxHunts));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const data: HuntReport[] = [];
                snapshot.forEach((doc) => {
                    data.push({ id: doc.id, ...doc.data() } as HuntReport);
                });
                setHunts(data);
                setHasMore(snapshot.size >= maxHunts);
                setLoading(false);
            },
            (err) => {
                console.error('Error fetching hunt reports:', err);
                setLoading(false);
            }
        );
        return () => unsubscribe();
    }, [verdict, maxHunts]);

    const loadMore = () => setMaxHunts((n) => n + pageSize);

    return { hunts, loading, hasMore, loadMore };
};
