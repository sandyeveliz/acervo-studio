import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { mcpApi } from "@/lib/api";

interface McpConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function McpConfigDialog({ open, onOpenChange, onSaved }: McpConfigDialogProps) {
  const [config, setConfig] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setLoading(true);
    mcpApi
      .getConfig()
      .then((res) => setConfig(JSON.stringify(res.config, null, 2)))
      .catch(() => setConfig('{\n  "mcpServers": {}\n}'))
      .finally(() => setLoading(false));
  }, [open]);

  const handleSave = async () => {
    setError("");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(config);
    } catch {
      setError("Invalid JSON");
      return;
    }
    setSaving(true);
    try {
      await mcpApi.saveConfig(parsed);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>MCP Configuration</DialogTitle>
          <DialogDescription>
            Edit .mcp.json to configure MCP servers. Changes take effect after probing.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Loading...</div>
        ) : (
          <textarea
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            spellCheck={false}
            className="w-full h-64 resize-none rounded-md border border-input bg-secondary/50 px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <DialogFooter>
          <Button onClick={handleSave} disabled={saving || loading} size="sm">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
