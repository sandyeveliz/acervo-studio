import type { Message, StepGroup } from "@/lib/types";

interface ExportData {
  exported_at: string;
  messages: Message[];
  traces: StepGroup[];
}

export function exportAsJson(messages: Message[], traces: StepGroup[]): void {
  const data: ExportData = {
    exported_at: new Date().toISOString(),
    messages,
    traces,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, `acervo-session-${timestamp()}.json`);
}

export function exportAsMarkdown(
  messages: Message[],
  traces: StepGroup[],
): void {
  const lines: string[] = [];
  lines.push(`# Acervo Session Export`);
  lines.push(`> ${new Date().toLocaleString()}`);
  lines.push("");

  // Build a map of trace groups by turn index
  const traceByTurn = new Map<number, StepGroup>();
  traces.forEach((g, i) => traceByTurn.set(i, g));

  let turnIdx = 0;

  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : "Assistant";
    lines.push(`## ${role}`);
    lines.push(msg.content);
    lines.push("");

    // After assistant message, append trace if available
    if (msg.role === "assistant") {
      const trace = traceByTurn.get(turnIdx);
      if (trace && trace.steps.length > 0) {
        lines.push(`<details><summary>Trace (${trace.steps.length} steps)</summary>`);
        lines.push("");
        for (const step of trace.steps) {
          lines.push(`- **${step.label}**: ${step.detail}`);
        }
        lines.push("");
        lines.push(`</details>`);
        lines.push("");
      }
      turnIdx++;
    }
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  downloadBlob(blob, `acervo-session-${timestamp()}.md`);
}

export function copyAsMarkdown(
  messages: Message[],
  traces: StepGroup[],
): string {
  const lines: string[] = [];

  let turnIdx = 0;
  for (const msg of messages) {
    const role = msg.role === "user" ? "**User**" : "**Assistant**";
    lines.push(`${role}: ${msg.content}`);

    if (msg.role === "assistant") {
      const trace = traces[turnIdx];
      if (trace && trace.steps.length > 0) {
        lines.push(
          `> Trace: ${trace.steps.map((s) => s.detail).join(" | ")}`,
        );
      }
      turnIdx++;
    }
    lines.push("");
  }

  return lines.join("\n");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
