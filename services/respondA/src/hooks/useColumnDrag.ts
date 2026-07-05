import { useState } from 'react';
import type { DragEvent } from 'react';
import type { EventColumn } from '../lib/columns';

/**
 * Drag-to-reorder for table header columns (HTML5 drag & drop).
 * Spread `handlers(i)` onto each draggable header cell and use
 * `headerClass(i)` for drag-state styling.
 */
export const useColumnDrag = (
    columns: EventColumn[],
    onReorder: (next: EventColumn[]) => void
) => {
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    const handlers = (index: number) => ({
        draggable: true,
        onDragStart: (e: DragEvent) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = 'move';
            // Some browsers require data for a drag to start.
            e.dataTransfer.setData('text/plain', columns[index]?.id ?? '');
        },
        onDragOver: (e: DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOverIndex(index);
        },
        onDragLeave: () => {
            setOverIndex(cur => (cur === index ? null : cur));
        },
        onDrop: (e: DragEvent) => {
            e.preventDefault();
            if (dragIndex !== null && dragIndex !== index) {
                const next = [...columns];
                const [moved] = next.splice(dragIndex, 1);
                next.splice(index, 0, moved);
                onReorder(next);
            }
            setDragIndex(null);
            setOverIndex(null);
        },
        onDragEnd: () => {
            setDragIndex(null);
            setOverIndex(null);
        },
    });

    const headerClass = (index: number) =>
        [
            dragIndex === index ? 'opacity-40' : '',
            overIndex === index && dragIndex !== null && dragIndex !== index
                ? 'border-l-2 border-primary'
                : '',
        ].join(' ');

    return { handlers, headerClass, isDragging: dragIndex !== null };
};
