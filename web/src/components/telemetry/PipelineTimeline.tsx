import type { TelemetrySpan } from "@/lib/api";

const STAGES = [
  { key: "s1", label: "S1", color: "bg-blue-500" },
  { key: "s2", label: "S2", color: "bg-teal-500" },
  { key: "s3", label: "S3", color: "bg-amber-500" },
  { key: "llm", label: "LLM", color: "bg-pink-500" },
  { key: "s15", label: "S1.5", color: "bg-violet-500" },
] as const;

interface PipelineTimelineProps {
  span: TelemetrySpan;
}

export function PipelineTimeline({ span }: PipelineTimelineProps) {
  const values = STAGES.map((s) => {
    const stage = span[s.key as keyof TelemetrySpan] as { latency_ms?: number };
    return { ...s, ms: stage?.latency_ms ?? 0 };
  });
  const total = values.reduce((a, v) => a + v.ms, 0) || 1;

  return (
    <div className="flex items-center gap-0.5 h-6 rounded overflow-hidden">
      {values.map((v) => {
        const pct = (v.ms / total) * 100;
        if (pct < 1) return null;
        return (
          <div
            key={v.key}
            className={`${v.color} h-full flex items-center justify-center text-[9px] text-white font-medium`}
            style={{ width: `${pct}%`, minWidth: pct > 5 ? "auto" : 0 }}
            title={`${v.label}: ${v.ms}ms`}
          >
            {pct > 8 ? `${v.label} ${v.ms > 1000 ? `${(v.ms / 1000).toFixed(1)}s` : `${v.ms}ms`}` : ""}
          </div>
        );
      })}
    </div>
  );
}
