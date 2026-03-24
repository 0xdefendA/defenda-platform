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
    critical: 'border-accent text-accent',
    high: 'border-[#F59F00] text-[#F59F00]',
    medium: 'border-primary text-primary',
    low: 'border-muted text-muted',
};

// Based on the HTML:
// Critical: border border-accent text-accent
// High: border border-[#F59F00] text-[#F59F00]
// Warn (Medium?): border border-[#FCC419] text-[#E67700] bg-[#FFF9DB]
// Info (Low?): border border-muted text-muted

export const SeverityBadge = ({ severity, className }: SeverityBadgeProps) => {
    let label = severity.substring(0, 4).toUpperCase();
    if (severity === 'critical') label = 'CRIT';
    if (severity === 'medium') label = 'MED';
    if (severity === 'low') label = 'INFO';

    // Special case for "Warn" styling in HTML which maps to Medium here
    const isMedium = severity === 'medium';

    return (
        <span className={cn(
            'inline-flex items-center justify-center px-1.5 py-0.5 border font-mono text-[10px] font-bold tracking-wider',
            severityStyles[severity],
            isMedium && 'border-[#FCC419] text-[#E67700] bg-[#FFF9DB]',
            className
        )}>
            {label}
        </span>
    );
};
