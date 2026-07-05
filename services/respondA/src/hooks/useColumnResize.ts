import type { MouseEvent as ReactMouseEvent } from 'react';
import type { EventColumn } from '../lib/columns';

const MIN_WIDTH = 60;

/**
 * Drag-to-resize for table header columns. Render `<ResizeHandle />`-style
 * spans with `resizeHandleProps(i)` at the right edge of each header cell
 * (the cell needs `relative` positioning). Double-click resets to automatic.
 */
export const useColumnResize = (
    columns: EventColumn[],
    onChange: (next: EventColumn[]) => void
) => {
    const resizeHandleProps = (index: number) => ({
        onMouseDown: (e: ReactMouseEvent) => {
            // Don't start a sort click or an HTML5 column drag.
            e.preventDefault();
            e.stopPropagation();
            const headerEl = (e.currentTarget as HTMLElement).parentElement;
            if (!headerEl) return;
            const startWidth = headerEl.offsetWidth;
            const startX = e.clientX;
            const colId = columns[index].id;

            const onMove = (ev: MouseEvent) => {
                const width = Math.max(MIN_WIDTH, Math.round(startWidth + ev.clientX - startX));
                onChange(columns.map(c => (c.id === colId ? { ...c, width } : c)));
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        },
        onDoubleClick: (e: ReactMouseEvent) => {
            // Reset to automatic sizing.
            e.preventDefault();
            e.stopPropagation();
            const colId = columns[index].id;
            onChange(columns.map(c => {
                if (c.id !== colId) return c;
                const { width: _width, ...rest } = c;
                return rest;
            }));
        },
        onClick: (e: ReactMouseEvent) => e.stopPropagation(),
        draggable: false,
        title: 'Drag to resize — double-click to reset',
        className: 'absolute right-0 top-0 h-full w-[5px] cursor-col-resize hover:bg-primary/40 z-10',
    });

    return { resizeHandleProps };
};
