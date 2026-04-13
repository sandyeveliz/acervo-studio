import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Pencil, X, AlertTriangle } from "lucide-react";
import type { ValidationLogEntry } from "@/lib/api";

interface ValidationPanelProps {
  entries: ValidationLogEntry[];
  unavailable?: boolean;
  onApprove: (entryId: string) => void;
  onCorrect: (entryId: string, correctedType: string, correctedRelation?: string) => void;
  onDiscard: (entryId: string) => void;
}

export function ValidationPanel({
  entries,
  unavailable,
  onApprove,
  onCorrect,
  onDiscard,
}: ValidationPanelProps) {
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctedType, setCorrectedType] = useState("");
  const [correctedRelation, setCorrectedRelation] = useState("");

  if (unavailable) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <AlertTriangle size={32} strokeWidth={1.5} />
        <p className="text-xs">Validation log not available — backend endpoint not connected yet</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <p className="text-xs">No validation entries</p>
      </div>
    );
  }

  const pending = entries.filter((e) => !e.action);
  const resolved = entries.filter((e) => e.action);

  return (
    <div className="max-h-[280px] overflow-y-auto space-y-1 p-1">
      {/* Pending entries first */}
      {pending.map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-2 px-2.5 py-2 rounded-md border border-border bg-card"
        >
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-xs">
              <Badge variant="outline" className="text-[10px]">{entry.original_type}</Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="secondary" className="text-[10px]">{entry.mapped_type}</Badge>
              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate" title={entry.context}>
              {entry.context}
            </p>

            {/* Inline correction form */}
            {correctingId === entry.id && (
              <div className="space-y-1.5 pt-1">
                <input
                  type="text"
                  placeholder="Corrected type..."
                  value={correctedType}
                  onChange={(e) => setCorrectedType(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/50 px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="Corrected relation (optional)..."
                  value={correctedRelation}
                  onChange={(e) => setCorrectedRelation(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/50 px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex gap-1.5">
                  <Button
                    size="xs"
                    className="text-xs"
                    disabled={!correctedType.trim()}
                    onClick={() => {
                      onCorrect(entry.id, correctedType.trim(), correctedRelation.trim() || undefined);
                      setCorrectingId(null);
                      setCorrectedType("");
                      setCorrectedRelation("");
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    className="text-xs"
                    onClick={() => {
                      setCorrectingId(null);
                      setCorrectedType("");
                      setCorrectedRelation("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          {correctingId !== entry.id && (
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => onApprove(entry.id)}
                className="p-1 rounded hover:bg-accent text-green-500 cursor-pointer"
                title="Approve mapping"
              >
                <Check size={14} />
              </button>
              <button
                onClick={() => {
                  setCorrectingId(entry.id);
                  setCorrectedType(entry.mapped_type);
                }}
                className="p-1 rounded hover:bg-accent text-amber-500 cursor-pointer"
                title="Correct mapping"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => onDiscard(entry.id)}
                className="p-1 rounded hover:bg-accent text-destructive cursor-pointer"
                title="Discard"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Resolved entries */}
      {resolved.length > 0 && (
        <>
          <div className="text-[10px] text-muted-foreground px-2 pt-2 uppercase tracking-wider">
            Resolved ({resolved.length})
          </div>
          {resolved.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/30 text-muted-foreground"
            >
              <div className="flex items-center gap-1.5 text-xs flex-1 min-w-0">
                <Badge variant="outline" className="text-[10px] opacity-60">{entry.original_type}</Badge>
                <span>→</span>
                <Badge variant="outline" className="text-[10px] opacity-60">
                  {entry.corrected_type ?? entry.mapped_type}
                </Badge>
              </div>
              <Badge
                variant={entry.action === "approved" ? "secondary" : entry.action === "corrected" ? "outline" : "ghost"}
                className="text-[9px] shrink-0"
              >
                {entry.action}
              </Badge>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
