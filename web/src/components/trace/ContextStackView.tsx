import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";

interface ContextStackViewProps {
  raw: Record<string, unknown>;
}

interface ContextMsg {
  role: string;
  content: string;
}

const LAYER_COLORS: Record<string, string> = {
  system: "bg-amber-400/60",
  warm: "bg-orange-400/60",
  hot: "bg-blue-400/60",
  user: "bg-emerald-400/60",
};

const ROLE_COLORS: Record<string, string> = {
  system: "text-amber-400/70",
  user: "text-blue-400/70",
  assistant: "text-emerald-400/70",
};

function detectLayer(msg: ContextMsg, index: number, total: number): string {
  if (msg.role === "system") return "system";
  if (msg.content.includes("[CONTEXTO VERIFICADO]") || msg.content.includes("[ACERVO CONTEXT") || msg.content.includes("[VERIFIED CONTEXT]")) return "warm";
  if (msg.role === "assistant" && (msg.content === "Entendido." || msg.content === "Understood.")) return "warm";
  if (msg.role === "user" && index === total - 1) return "user";
  return "hot";
}

function LayerSection({ msg, layer, index }: { msg: ContextMsg; layer: string; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = msg.content.length > 200;
  const preview = isLong ? msg.content.slice(0, 200) + "…" : msg.content;

  return (
    <div className="border-l-2 border-border/30 pl-2 py-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left cursor-pointer"
      >
        {isLong ? (
          expanded ? <ChevronDown size={12} className="text-muted-foreground/60 shrink-0" /> :
            <ChevronRight size={12} className="text-muted-foreground/60 shrink-0" />
        ) : <span className="w-3" />}
        <span className={`text-[13px] font-mono uppercase ${ROLE_COLORS[msg.role] ?? "text-muted-foreground/60"}`}>
          {msg.role}
        </span>
        <span className="text-[12px] text-muted-foreground/50 font-mono">{layer}</span>
        {isLong && (
          <span className="text-[12px] text-muted-foreground/40 font-mono ml-auto">{msg.content.length}ch</span>
        )}
      </button>
      <pre className="text-[13px] text-muted-foreground/70 whitespace-pre-wrap break-words max-h-28 overflow-y-auto font-mono leading-5 mt-0.5 ml-4">
        {expanded || !isLong ? msg.content : preview}
      </pre>
    </div>
  );
}

export function ContextStackView({ raw }: ContextStackViewProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const summary = raw.context_summary as string | undefined;
  const warmTk = (raw.warm_tokens as number) ?? 0;
  const hotTk = (raw.hot_tokens as number) ?? 0;
  const totalTk = (raw.total_tokens as number) ?? 0;

  let messages: ContextMsg[] = [];
  if (summary) {
    try {
      messages = JSON.parse(summary);
    } catch {
      // not JSON
    }
  }

  // Estimate layer token proportions
  const systemTk = Math.max(0, totalTk - warmTk - hotTk);
  const segments = [
    { key: "system", tokens: systemTk, color: LAYER_COLORS.system },
    { key: "warm", tokens: warmTk, color: LAYER_COLORS.warm },
    { key: "hot", tokens: hotTk, color: LAYER_COLORS.hot },
  ].filter(s => s.tokens > 0);

  const handleCopy = async () => {
    const text = messages.map(m => `[${m.role}]\n${m.content}`).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[13px] text-blue-400/80 hover:text-blue-400 font-mono cursor-pointer"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>context stack</span>
        <span className="text-muted-foreground/50">
          ({totalTk}tk{warmTk ? ` · warm ${warmTk}tk` : ""}{hotTk ? ` · hot ${hotTk}tk` : ""})
        </span>
      </button>

      {open && (
        <div className="mt-1.5 ml-2 space-y-1.5">
          {/* Token proportion bar */}
          {totalTk > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden flex">
                {segments.map(s => (
                  <div
                    key={s.key}
                    className={`h-full ${s.color}`}
                    style={{ width: `${(s.tokens / totalTk) * 100}%` }}
                  />
                ))}
              </div>
              <span className="text-[12px] text-muted-foreground/50 font-mono shrink-0">{totalTk}tk</span>
            </div>
          )}

          {/* Legend */}
          <div className="flex gap-3 text-[12px] font-mono text-muted-foreground/50">
            {segments.map(s => (
              <span key={s.key} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-sm ${s.color}`} />
                {s.key} {s.tokens}tk
              </span>
            ))}
          </div>

          {/* Messages */}
          {messages.length > 0 && (
            <div className="space-y-0.5">
              {messages.map((msg, i) => (
                <LayerSection
                  key={i}
                  msg={msg}
                  layer={detectLayer(msg, i, messages.length)}
                  index={i}
                />
              ))}
            </div>
          )}

          {/* Fallback: raw summary text */}
          {messages.length === 0 && summary && (
            <pre className="text-[13px] text-muted-foreground/70 whitespace-pre-wrap break-words max-h-32 overflow-y-auto font-mono">
              {summary}
            </pre>
          )}

          {/* Copy button */}
          {messages.length > 0 && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[12px] text-muted-foreground/50 hover:text-muted-foreground font-mono cursor-pointer"
            >
              {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
              {copied ? "copied" : "copy context"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
