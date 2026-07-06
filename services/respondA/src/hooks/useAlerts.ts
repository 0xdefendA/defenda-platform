import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Alert } from '../types';

const PAGE_SIZE = 50;

/**
 * Streams alerts with "load more" pagination: growing the limit keeps a
 * single realtime listener so every loaded row stays live.
 */
export const useAlerts = (status: string | null = 'OPEN', pageSize = PAGE_SIZE) => {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [maxAlerts, setMaxAlerts] = useState(pageSize);
    const [hasMore, setHasMore] = useState(false);

    // Reset pagination when the status filter changes
    useEffect(() => {
        setMaxAlerts(pageSize);
    }, [status, pageSize]);

    useEffect(() => {
        let q = query(
            collection(db, 'alerts'),
            orderBy('created_at', 'desc'),
            limit(maxAlerts)
        );

        if (status) {
            q = query(
                collection(db, 'alerts'),
                where('status', '==', status),
                orderBy('created_at', 'desc'),
                limit(maxAlerts)
            );
        }

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const alertsData: Alert[] = [];
                snapshot.forEach((doc) => {
                    alertsData.push({ id: doc.id, ...doc.data() } as Alert);
                });
                setAlerts(alertsData);
                // A full page means there are probably more behind it
                setHasMore(snapshot.size >= maxAlerts);
                setLoading(false);
            },
            (err) => {
                console.error('Error fetching alerts:', err);
                setError(err as Error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [status, maxAlerts]);

    const loadMore = () => setMaxAlerts(current => current + pageSize);

    return { alerts, loading, error, hasMore, loadMore };
};
