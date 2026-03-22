import type { PipelineStep } from "@/lib/types";
import { getEventLabel, getEventSource } from "@/lib/eventNames";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function sourceLabel(source: string): string {
  return source === "avs" ? "AVS" : source === "acr" ? "ACR" : source === "llm" ? "LLM" : source === "mcp" ? "MCP" : source.toUpperCase();
}

function stepToMarkdown(step: PipelineStep): string {
  const time = formatTime(step.timestamp);
  const source = sourceLabel(getEventSource(step.type));
  const label = getEventLabel(step.type);
  const detail = step.detail ? ` — ${step.detail}` : "";
  const raw = Object.keys(step.raw).length > 0
    ? `\n\`\`\`json\n${JSON.stringify(step.raw, null, 2)}\n\`\`\``
    : "";
  return `### [${time}] ${source} — ${label}${detail}${raw}`;
}

export async function copyEntryAsMarkdown(step: PipelineStep): Promise<void> {
  await navigator.clipboard.writeText(stepToMarkdown(step));
}

export async function copyFullTraceAsMarkdown(steps: PipelineStep[]): Promise<void> {
  const header = "# Pipeline Trace\n";
  const body = steps.map(stepToMarkdown).join("\n\n---\n\n");
  await navigator.clipboard.writeText(header + "\n" + body);
}

export { formatTime };
