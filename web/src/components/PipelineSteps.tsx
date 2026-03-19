import { useState } from "react";
import { StepBadge } from "./StepBadge";
import type { StepGroup } from "@/lib/types";

interface PipelineStepsProps {
  groups: StepGroup[];
  currentTurnActive: boolean;
}

export function PipelineSteps({ groups, currentTurnActive }: PipelineStepsProps) {
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-4">
      {groups.map((group, i) => {
        const isLast = i === groups.length - 1;
        return (
          <TurnSteps
            key={group.turnId}
            group={group}
            defaultOpen={isLast && currentTurnActive}
            isActive={isLast && currentTurnActive}
          />
        );
      })}
    </div>
  );
}

interface TurnStepsProps {
  group: StepGroup;
  defaultOpen: boolean;
  isActive: boolean;
}

function TurnSteps({ group, defaultOpen, isActive }: TurnStepsProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (group.steps.length === 0) return null;

  // Always show active turn expanded
  const isOpen = isActive || open;

  return (
    <div className="border-l-2 border-border pl-3 py-1">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground font-mono cursor-pointer"
      >
        {isOpen ? "▼" : "▶"} {group.steps.length} steps
        {isActive && (
          <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </button>
      {isOpen && (
        <div className="flex flex-col gap-0.5 mt-1">
          {group.steps.map((step, j) => (
            <StepBadge key={`${step.type}-${j}`} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
