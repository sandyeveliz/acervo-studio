import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Info,
  Copy,
  Merge,
  Trash2,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Unlink,
  HelpCircle,
  FileQuestion,
} from "lucide-react";
import type { QualityIssue } from "@/lib/api";

interface QualityIssuesPanelProps {
  issues: QualityIssue[];
  onSelectNode: (nodeId: string) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onDeleteNode: (nodeId: string) => void;
}

const ISSUE_ICONS: Record<string, typeof AlertTriangle> = {
  duplicate: Copy,
  leakage: ShieldAlert,
  orphan: Unlink,
  unknown_type: HelpCircle,
  empty_facts: FileQuestion,
};

const ISSUE_LABELS: Record<string, string> = {
  duplicate: "Duplicates",
  leakage: "Prompt Leakage",
  orphan: "Orphans",
  unknown_type: "Unknown Type",
  empty_facts: "Empty Facts",
};

export function QualityIssuesPanel({
  issues,
  onSelectNode,
  onMerge,
  onDeleteNode,
}: QualityIssuesPanelProps) {
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());

  const visibleIssues = issues.filter(
    (issue) => !ignoredIds.has(issue.node_ids.join(",")),
  );

  // Group by type
  const grouped: Record<string, QualityIssue[]> = {};
  for (const issue of visibleIssues) {
    if (!grouped[issue.type]) grouped[issue.type] = [];
    grouped[issue.type].push(issue);
  }

  const handleIgnore = (issue: QualityIssue) => {
    setIgnoredIds((prev) => new Set([...prev, issue.node_ids.join(",")]));
  };

  if (issues.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No quality issues detected.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <AlertTriangle size={14} />
          Quality Issues ({visibleIssues.length})
          {ignoredIds.size > 0 && (
            <span className="text-xs text-muted-foreground font-normal">
              ({ignoredIds.size} ignored)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-1">
            {Object.entries(grouped).map(([type, typeIssues]) => {
              const Icon = ISSUE_ICONS[type] ?? Info;
              const isExpanded = expandedType === type;
              return (
                <div key={type}>
                  <button
                    onClick={() =>
                      setExpandedType(isExpanded ? null : type)
                    }
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 text-sm cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    <Icon size={14} className="text-muted-foreground" />
                    <span className="flex-1 text-left">
                      {ISSUE_LABELS[type] ?? type}
                    </span>
                    <Badge
                      variant={
                        typeIssues[0].severity === "warning"
                          ? "destructive"
                          : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {typeIssues.length}
                    </Badge>
                  </button>

                  {isExpanded && (
                    <div className="ml-4 space-y-1 mt-1">
                      {typeIssues.map((issue, i) => (
                        <IssueRow
                          key={i}
                          issue={issue}
                          onSelectNode={onSelectNode}
                          onMerge={onMerge}
                          onDeleteNode={onDeleteNode}
                          onIgnore={() => handleIgnore(issue)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function IssueRow({
  issue,
  onSelectNode,
  onMerge,
  onDeleteNode,
  onIgnore,
}: {
  issue: QualityIssue;
  onSelectNode: (id: string) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onDeleteNode: (id: string) => void;
  onIgnore: () => void;
}) {
  return (
    <div className="rounded-md border border-border p-2 text-xs space-y-1.5">
      <p className="text-muted-foreground">{issue.message}</p>
      <p className="text-[11px] text-muted-foreground/70">{issue.reason}</p>
      <div className="flex gap-1.5 flex-wrap">
        {issue.node_ids.map((id) => (
          <button
            key={id}
            onClick={() => onSelectNode(id)}
            className="text-[11px] text-primary underline cursor-pointer hover:text-primary/80"
          >
            {issue.nodes.find((n) => n.id === id)?.label ?? id}
          </button>
        ))}
      </div>
      <div className="flex gap-1 pt-0.5">
        {issue.type === "duplicate" && issue.node_ids.length === 2 && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={() =>
              onMerge(issue.node_ids[0], issue.node_ids[1])
            }
          >
            <Merge size={10} className="mr-1" />
            Merge
          </Button>
        )}
        {(issue.type === "orphan" || issue.type === "leakage") &&
          issue.node_ids.length === 1 && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2 text-destructive-foreground"
              onClick={() => onDeleteNode(issue.node_ids[0])}
            >
              <Trash2 size={10} className="mr-1" />
              Delete
            </Button>
          )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={onIgnore}
        >
          Ignore
        </Button>
      </div>
    </div>
  );
}
