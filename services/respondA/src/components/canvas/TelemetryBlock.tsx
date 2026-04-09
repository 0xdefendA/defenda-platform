interface TelemetryBlockProps {
    payload: Record<string, any>;
}

export const TelemetryBlock = ({ payload }: TelemetryBlockProps) => {
    return (
        <div className="bg-muted/10 rounded-lg p-4 font-mono text-[11px] overflow-auto max-h-[300px] border border-border">
            <pre className="text-text/80 whitespace-pre-wrap break-all">
                {JSON.stringify(payload, null, 2)}
            </pre>
        </div>
    );
};
