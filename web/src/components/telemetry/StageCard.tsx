import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  s1: "bg-blue-500",
  s2: "bg-teal-500",
  s3: "bg-amber-500",
  llm: "bg-pink-500",
  s15: "bg-violet-500",
};

interface StageCardProps {
  stage: string;       // "s1" | "s2" | "s3" | "llm" | "s15"
  label: string;       // "S1 — Intent + Extraction"
  latencyMs: number;
  ok?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  badge?: string;      // e.g. "6 entities"
}

export function StageCard({ stage, label, latencyMs, ok = true, defaultOpen = false, children, badge }: StageCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const color = STAGE_COLORS[stage] || "bg-muted";

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/30 transition-colors cursor-pointer"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className={cn("w-2 h-2 rounded-full shrink-0", color)} />
        <span className="font-medium">{label}</span>
        {badge && <span className="text-xs text-muted-foreground">{badge}</span>}
        <span className="ml-auto flex items-center gap-2">
          {!ok && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
          <span className="text-xs text-muted-foreground tabular-nums">
            {latencyMs > 1000 ? `${(latencyMs / 1000).toFixed(1)}s` : `${latencyMs}ms`}
          </span>
        </span>
      </button>
      {open && <div className="px-3 pb-3 border-t border-border">{children}</div>}
    </div>
  );
}

/** Collapsible raw data panel (for prompts, responses, etc.) */
export function RawPanel({ title, data, defaultOpen = false }: { title: string; data: unknown; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  // Try to pretty-print: if data is a JSON string, parse and re-stringify
  let content: string;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      content = JSON.stringify(parsed, null, 2);
    } catch {
      content = data;
    }
  } else {
    content = JSON.stringify(data, null, 2);
  }

  if (!content || content === '""' || content === "null" || content === "undefined") return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {title}
      </button>
      {open && (
        <pre className="mt-1 p-2 text-[11px] bg-muted/30 rounded border border-border overflow-x-auto max-h-96 whitespace-pre-wrap break-words text-muted-foreground">
          {content}
        </pre>
      )}
    </div>
  );
}

/** Key-value row for stage details */
export function DetailRow({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs", mono && "font-mono")}>{value}</span>
    </div>
  );
}
