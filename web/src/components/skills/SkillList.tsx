import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Download, ChevronRight } from "lucide-react";
import type { SkillSummary } from "@/lib/api";

interface SkillListProps {
  skills: SkillSummary[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
  onInstall: () => void;
}

interface SkillGroup {
  label: string;
  repo: string;
  skills: SkillSummary[];
}

function groupSkills(skills: SkillSummary[]): SkillGroup[] {
  const groups = new Map<string, SkillSummary[]>();

  for (const skill of skills) {
    const key = skill.source || "custom";
    const list = groups.get(key) || [];
    list.push(skill);
    groups.set(key, list);
  }

  const result: SkillGroup[] = [];

  const repos = [...groups.keys()].filter((k) => k !== "custom").sort();
  for (const repo of repos) {
    const label = repo.replace("github:", "");
    result.push({ label, repo, skills: groups.get(repo)! });
  }

  if (groups.has("custom")) {
    result.push({ label: "Custom", repo: "custom", skills: groups.get("custom")! });
  }

  return result;
}

export function SkillList({ skills, selectedName, onSelect, onCreate, onDelete, onInstall }: SkillListProps) {
  const groups = useMemo(() => groupSkills(skills), [skills]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (repo: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-sm font-medium">Skills</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onInstall} className="h-7 w-7 p-0" title="Install from GitHub">
            <Download size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onCreate} className="h-7 w-7 p-0" title="Create new skill">
            <Plus size={14} />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {skills.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No skills yet. Create one or install from GitHub.
          </div>
        )}
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.repo);
          return (
            <div key={group.repo}>
              {/* Collapsible group header */}
              <button
                onClick={() => toggle(group.repo)}
                className="flex items-center gap-1.5 w-full px-3 py-2 mt-1 first:mt-0 hover:bg-accent/30 transition-colors cursor-pointer"
              >
                <ChevronRight
                  size={12}
                  className={cn(
                    "text-muted-foreground/40 transition-transform shrink-0",
                    !isCollapsed && "rotate-90",
                  )}
                />
                <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest truncate">
                  {group.label}
                </span>
                <span className="text-[10px] text-muted-foreground/30">
                  {group.skills.length}
                </span>
              </button>
              {/* Skills in this group */}
              {!isCollapsed &&
                group.skills.map((skill) => (
                  <div
                    key={skill.name}
                    onClick={() => onSelect(skill.name)}
                    className={cn(
                      "flex items-center justify-between pl-6 pr-3 py-2 cursor-pointer transition-colors group",
                      selectedName === skill.name
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{skill.name}</p>
                      {skill.description && (
                        <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(skill.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive-foreground transition-opacity cursor-pointer ml-2"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
