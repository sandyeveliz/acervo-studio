import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const NODE_TYPES = [
  "person", "place", "organization", "event", "concept", "topic",
  "technology", "project", "product", "skill",
];

const LAYERS = ["PERSONAL", "UNIVERSAL"];

interface CreateNodeDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateNode: (data: {
    label: string;
    type: string;
    description?: string;
    layer?: string;
    facts?: { fact: string; source?: string }[];
  }) => void;
}

export function CreateNodeDialog({ open, onClose, onCreateNode }: CreateNodeDialogProps) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState("concept");
  const [customType, setCustomType] = useState("");
  const [layer, setLayer] = useState("");
  const [description, setDescription] = useState("");
  const [factsText, setFactsText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const resolvedType = type === "__custom" ? customType.trim() : type;
    if (!label.trim() || !resolvedType) return;

    setSaving(true);
    try {
      const facts = factsText
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
        .map((fact) => ({ fact, source: "user" }));

      await onCreateNode({
        label: label.trim(),
        type: resolvedType,
        description: description.trim() || undefined,
        layer: layer || undefined,
        facts: facts.length > 0 ? facts : undefined,
      });

      // Reset form
      setLabel("");
      setType("concept");
      setCustomType("");
      setLayer("");
      setDescription("");
      setFactsText("");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Node</DialogTitle>
          <DialogDescription>Add a new node to the knowledge graph.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Label */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Label *</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Node label..."
              className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              autoFocus
            />
          </div>

          {/* Type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Type *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {NODE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value="__custom">Custom...</option>
            </select>
            {type === "__custom" && (
              <input
                type="text"
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                placeholder="Custom type name..."
                className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1"
              />
            )}
          </div>

          {/* Layer */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Layer</label>
            <select
              value={layer}
              onChange={(e) => setLayer(e.target.value)}
              className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">None</option>
              {LAYERS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Facts */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Initial facts (one per line)</label>
            <textarea
              value={factsText}
              onChange={(e) => setFactsText(e.target.value)}
              placeholder="Each line becomes a fact..."
              rows={3}
              className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!label.trim() || (type === "__custom" && !customType.trim()) || saving}
            className="text-xs"
          >
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
