import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { skillsApi, type BrowseSkill } from "@/lib/api";
import { Download, Loader2, Search, Check, AlertCircle } from "lucide-react";

interface InstallSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
}

export function InstallSkillDialog({ open, onOpenChange, onInstalled }: InstallSkillDialogProps) {
  const [input, setInput] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [repo, setRepo] = useState("");
  const [available, setAvailable] = useState<BrowseSkill[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleBrowse = async () => {
    if (!input.trim()) return;
    setBrowsing(true);
    setError("");
    setAvailable([]);
    setSelected(new Set());
    try {
      const res = await skillsApi.browse(input.trim());
      setRepo(res.repo);
      if (res.skills.length === 0) {
        setError(res.error || "No skills found in this repository.");
      } else {
        setAvailable(res.skills);
        // Select all by default
        setSelected(new Set(res.skills.map((s) => s.name)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to browse repository");
    } finally {
      setBrowsing(false);
    }
  };

  const toggleSkill = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === available.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(available.map((s) => s.name)));
    }
  };

  const handleInstall = async () => {
    if (selected.size === 0) return;
    setInstalling(true);
    setError("");
    try {
      const res = await skillsApi.install(input.trim(), Array.from(selected));
      onInstalled();
      onOpenChange(false);
      // Reset state
      setInput("");
      setAvailable([]);
      setSelected(new Set());
      setRepo("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Installation failed");
    } finally {
      setInstalling(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setInput("");
      setAvailable([]);
      setSelected(new Set());
      setError("");
      setRepo("");
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent showCloseButton className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Install Skills from GitHub</DialogTitle>
          <DialogDescription>
            Paste a GitHub repo URL, owner/repo, or npx command.
          </DialogDescription>
        </DialogHeader>

        {/* Input row */}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleBrowse();
            }}
            placeholder="obra/superpowers or https://github.com/..."
            className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button onClick={handleBrowse} disabled={browsing || !input.trim()} size="sm">
            {browsing ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            <span className="ml-1.5">{browsing ? "Searching..." : "Browse"}</span>
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Skill list */}
        {available.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {available.length} skill{available.length !== 1 ? "s" : ""} found in <span className="font-mono">{repo}</span>
              </p>
              <button
                onClick={toggleAll}
                className="text-xs text-primary hover:underline cursor-pointer"
              >
                {selected.size === available.length ? "Deselect all" : "Select all"}
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {available.map((skill) => (
                <label
                  key={skill.name}
                  className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(skill.name)}
                    onChange={() => toggleSkill(skill.name)}
                    className="mt-0.5 rounded border-border"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{skill.name}</p>
                    {skill.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {skill.description}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        {available.length > 0 && (
          <DialogFooter>
            <Button onClick={handleInstall} disabled={installing || selected.size === 0}>
              {installing ? (
                <Loader2 size={14} className="animate-spin mr-1.5" />
              ) : (
                <Download size={14} className="mr-1.5" />
              )}
              {installing
                ? "Installing..."
                : `Install ${selected.size} skill${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
