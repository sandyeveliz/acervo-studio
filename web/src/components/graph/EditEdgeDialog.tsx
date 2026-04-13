import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, User, Cog, Check, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { GraphSource, GraphStatus } from "@/lib/api";

const SOURCE_ICONS: Record<GraphSource, typeof Bot> = {
  llm: Bot,
  user: User,
  system: Cog,
};

const SOURCE_LABELS: Record<GraphSource, string> = {
  llm: "LLM",
  user: "User",
  system: "System",
};

function confidenceColor(c: number | undefined): string {
  if (c == null) return "text-muted-foreground";
  if (c >= 0.8) return "text-emerald-500";
  if (c >= 0.6) return "text-amber-500";
  return "text-red-500";
}

const RELATION_TYPES = [
  "related_to", "part_of", "contains", "created_by", "member_of",
  "located_in", "depends_on", "uses_technology", "alternative_to",
  "deployed_on", "produces", "serves", "documented_in",
  "participated_in", "triggered_by", "resulted_in",
  "sequel_of", "prequel_of", "shares_characters_with",
];

interface EditEdgeDialogProps {
  open: boolean;
  edgeId: string;
  currentRelation: string;
  sourceLabel: string;
  targetLabel: string;
  onClose: () => void;
  onSave: (edgeId: string, newRelation: string) => void;
  // v0.6.1 read-only metadata
  confidence?: number;
  edgeSource?: GraphSource;
  status?: GraphStatus | null;
  onConfirm?: (edgeId: string) => void;
}

export function EditEdgeDialog({
  open,
  edgeId,
  currentRelation,
  sourceLabel,
  targetLabel,
  onClose,
  onSave,
  confidence,
  edgeSource,
  status,
  onConfirm,
}: EditEdgeDialogProps) {
  const SourceIcon = edgeSource ? SOURCE_ICONS[edgeSource] : null;
  const isPending = status === "pending_review";
  const [relation, setRelation] = useState(currentRelation);
  const [customRelation, setCustomRelation] = useState("");
  const [saving, setSaving] = useState(false);

  const isCustom = !RELATION_TYPES.includes(relation) && relation !== "__custom";
  const displayRelation = isCustom ? "__custom" : relation;

  const handleSubmit = async () => {
    const resolvedRelation = displayRelation === "__custom" ? customRelation.trim() : relation;
    if (!resolvedRelation || resolvedRelation === currentRelation) return;

    setSaving(true);
    try {
      await onSave(edgeId, resolvedRelation);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Relation</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{sourceLabel}</span>
            {" → "}
            <span className="font-medium text-foreground">{targetLabel}</span>
          </DialogDescription>
          {(SourceIcon || confidence != null || isPending) && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {SourceIcon && edgeSource && (
                <Badge variant="outline" className="text-[11px] gap-1">
                  <SourceIcon size={10} />
                  {SOURCE_LABELS[edgeSource]}
                </Badge>
              )}
              {confidence != null && (
                <Badge variant="outline" className={`text-[11px] ${confidenceColor(confidence)}`}>
                  {Math.round(confidence * 100)}%
                </Badge>
              )}
              {isPending && (
                <Badge
                  variant="outline"
                  className="text-[11px] gap-1 border-amber-500/40 text-amber-500"
                >
                  <AlertTriangle size={10} />
                  pending review
                </Badge>
              )}
            </div>
          )}
        </DialogHeader>

        {isPending && onConfirm && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-xs">
            <AlertTriangle size={14} className="text-amber-500 shrink-0" />
            <span className="flex-1">Confirm this relation to mark it as reviewed.</span>
            <Button
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                onConfirm(edgeId);
                onClose();
              }}
            >
              <Check size={11} className="mr-1" />
              Confirm
            </Button>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Relation type</label>
            <select
              value={displayRelation}
              onChange={(e) => {
                setRelation(e.target.value);
                if (e.target.value !== "__custom") setCustomRelation("");
              }}
              className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {RELATION_TYPES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="__custom">Custom...</option>
            </select>
            {displayRelation === "__custom" && (
              <input
                type="text"
                value={customRelation || (isCustom ? currentRelation : "")}
                onChange={(e) => setCustomRelation(e.target.value)}
                placeholder="Custom relation type..."
                className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1"
                autoFocus
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={saving}
            className="text-xs"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
