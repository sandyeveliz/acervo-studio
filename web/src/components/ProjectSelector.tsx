import { useState, useEffect, useRef } from "react";
import { FolderOpen, ChevronDown, Plus, Loader2, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProject } from "@/hooks/useProject";
import { projectsApi } from "@/lib/api";

export function ProjectSelector() {
  const { projects, activeProject, activeId, switching, select, refresh } =
    useProject();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [addError, setAddError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSelect(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setOpen(false);
    await select(id);
  }

  async function handleAdd() {
    if (!newName.trim() || !newPath.trim()) return;
    setAddError("");
    try {
      await projectsApi.add(newName.trim(), newPath.trim());
      setAdding(false);
      setNewName("");
      setNewPath("");
      await refresh();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Failed to add project");
    }
  }

  return (
    <div ref={ref} className="relative px-2 mb-3">
      {/* Trigger */}
      <button
        onClick={() => !switching && setOpen(!open)}
        disabled={switching}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors",
          "border border-border/50",
          switching && "opacity-60",
          activeProject
            ? "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 cursor-pointer"
            : "text-sidebar-foreground/40 hover:text-sidebar-foreground/60 hover:bg-sidebar-accent/30 cursor-pointer",
        )}
      >
        {switching ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <FolderOpen size={14} />
        )}
        <span className="flex-1 text-left truncate">
          {switching
            ? "Switching..."
            : activeProject
              ? activeProject.name
              : "No project"}
        </span>
        <ChevronDown
          size={12}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-2 right-2 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-md">
          {/* Project list */}
          {projects.length > 0 && (
            <div className="p-1 max-h-48 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p.id)}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs transition-colors cursor-pointer",
                    p.id === activeId
                      ? "bg-accent text-accent-foreground"
                      : "text-popover-foreground/80 hover:bg-accent/50",
                    !p.valid && "opacity-50",
                  )}
                >
                  <Database size={12} />
                  <span className="flex-1 text-left truncate">{p.name}</span>
                  {p.nodes !== undefined && (
                    <span className="text-[10px] text-muted-foreground">
                      {p.nodes}n
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Separator */}
          {projects.length > 0 && <div className="border-t border-border" />}

          {/* Add project */}
          {!adding ? (
            <button
              onClick={() => {
                setAdding(true);
                setAddError("");
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:text-popover-foreground hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <Plus size={12} />
              Add project
            </button>
          ) : (
            <div className="p-2 space-y-2">
              <input
                type="text"
                placeholder="Project name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground"
                autoFocus
              />
              <input
                type="text"
                placeholder="Path to project folder"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              {addError && (
                <p className="text-[10px] text-destructive">{addError}</p>
              )}
              <div className="flex gap-1">
                <button
                  onClick={handleAdd}
                  className="flex-1 px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setAddError("");
                  }}
                  className="px-2 py-1 text-xs rounded text-muted-foreground hover:bg-accent cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
