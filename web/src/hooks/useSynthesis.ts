import { useState, useRef, useCallback } from "react";
import { synthesizeProject } from "@/lib/api";

export interface SynthesisState {
  status: "idle" | "running" | "complete" | "error";
  fileCount: number;
  nodesCreated: number;
  nodesUpdated: number;
  durationSeconds: number;
  errorMessage: string | null;
}

const INITIAL_STATE: SynthesisState = {
  status: "idle",
  fileCount: 0,
  nodesCreated: 0,
  nodesUpdated: 0,
  durationSeconds: 0,
  errorMessage: null,
};

export function useSynthesis() {
  const [state, setState] = useState<SynthesisState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const startSynthesis = useCallback(async (projectId: string) => {
    setState({ ...INITIAL_STATE, status: "running" });

    const { controller, response: responsePromise } = synthesizeProject(projectId);
    controllerRef.current = controller;

    try {
      const response = await responsePromise;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setState((s) => ({
          ...s,
          status: "error",
          errorMessage: body.detail ?? `HTTP ${response.status}`,
        }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setState((s) => ({ ...s, status: "error", errorMessage: "No response body" }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventName = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventName) {
            const data = JSON.parse(line.slice(6));
            handleEvent(eventName, data, setState);
            eventName = "";
          }
        }
      }

      setState((s) => (s.status === "running" ? { ...s, status: "complete" } : s));
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: e instanceof Error ? e.message : "Unknown error",
      }));
    } finally {
      controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState((s) => ({ ...s, status: "idle" }));
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, startSynthesis, cancel, reset };
}

function handleEvent(
  name: string,
  data: Record<string, unknown>,
  setState: React.Dispatch<React.SetStateAction<SynthesisState>>,
) {
  switch (name) {
    case "synthesis_started":
      setState((s) => ({
        ...s,
        fileCount: (data.file_count as number) ?? 0,
      }));
      break;
    case "overview_generated":
      setState((s) => ({
        ...s,
        nodesCreated: s.nodesCreated + 1,
      }));
      break;
    case "modules_generated":
      setState((s) => ({
        ...s,
        nodesCreated: s.nodesCreated + ((data.count as number) ?? 0),
      }));
      break;
    case "synthesis_complete":
      setState((s) => ({
        ...s,
        status: "complete",
        nodesCreated: (data.nodes_created as number) ?? s.nodesCreated,
        nodesUpdated: (data.nodes_updated as number) ?? 0,
        durationSeconds: (data.duration_seconds as number) ?? 0,
      }));
      break;
    case "error":
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: (data.error as string) ?? "Unknown error",
      }));
      break;
    case "done":
      setState((s) => (s.status === "running" ? { ...s, status: "complete" } : s));
      break;
  }
}
