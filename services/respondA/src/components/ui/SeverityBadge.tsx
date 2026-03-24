import type { Severity } from '../../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface SeverityBadgeProps {
    severity: Severity | string;
    className?: string;
}

const severityStyles: Record<string, string> = {
    critical: 'border-accent text-accent',
    high: 'border-[#F59F00] text-[#F59F00]',
    medium: 'border-[#FCC419] text-[#E67700] bg-[#FFF9DB]',
    low: 'border-success text-success',
    info: 'border-muted text-muted',
};

export const SeverityBadge = ({ severity, className }: SeverityBadgeProps) => {
    const sev = severity.toLowerCase();
    let label = sev.substring(0, 4).toUpperCase();

    if (sev === 'critical') label = 'CRIT';
    if (sev === 'medium') label = 'WARN';
    if (sev === 'low') label = 'LOW';
    if (sev === 'info') label = 'INFO';

    return (
        <span className={cn(
            'inline-flex items-center justify-center px-1.5 py-0.5 border font-mono text-[10px] font-bold tracking-wider',
            severityStyles[sev] || severityStyles.info,
            className
        )}>
            {label}
        </span>
    );
};
