import type { Severity } from '../../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface SeverityBadgeProps {
    severity: Severity;
    className?: string;
}

const severityStyles: Record<Severity, string> = {
    critical: 'bg-accent/10 text-accent border-accent/20',
    high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    low: 'bg-success/10 text-success border-success/20',
};

export const SeverityBadge = ({ severity, className }: SeverityBadgeProps) => {
    return (
        <span className={cn(
            'px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase tracking-wider',
            severityStyles[severity],
            className
        )}>
            {severity}
        </span>
    );
};
