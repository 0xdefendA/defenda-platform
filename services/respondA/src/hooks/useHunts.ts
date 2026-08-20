import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { HuntReport } from '../types';

const PAGE_SIZE = 50;

/**
 * Streams hunt_reports (written by huntA) newest-first, with "load more"
 * pagination — one growing realtime listener, like useAlerts.
 */
export const useHunts = (pageSize = PAGE_SIZE) => {
    const [hunts, setHunts] = useState<HuntReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [maxHunts, setMaxHunts] = useState(pageSize);
    const [hasMore, setHasMore] = useState(false);

    useEffect(() => {
        const q = query(
            collection(db, 'hunt_reports'),
            orderBy('created_at', 'desc'),
            limit(maxHunts)
        );
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
    }, [maxHunts]);

    const loadMore = () => setMaxHunts((n) => n + pageSize);

    return { hunts, loading, hasMore, loadMore };
};
