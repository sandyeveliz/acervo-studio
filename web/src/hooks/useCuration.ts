import { useState, useRef, useCallback } from "react";
import { curateProject } from "@/lib/api";

export interface CurationState {
  status: "idle" | "running" | "complete" | "error";
  totalBatches: number;
  batchesProcessed: number;
  relationsFound: number;
  entitiesCreated: number;
  totalFacts: number;
  durationSeconds: number;
  errorMessage: string | null;
}

const INITIAL_STATE: CurationState = {
  status: "idle",
  totalBatches: 0,
  batchesProcessed: 0,
  relationsFound: 0,
  entitiesCreated: 0,
  totalFacts: 0,
  durationSeconds: 0,
  errorMessage: null,
};

export function useCuration() {
  const [state, setState] = useState<CurationState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const startCuration = useCallback(async (projectId: string) => {
    setState({ ...INITIAL_STATE, status: "running" });

    const { controller, response: responsePromise } = curateProject(projectId);
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

  return { state, startCuration, cancel, reset };
}

function handleEvent(
  name: string,
  data: Record<string, unknown>,
  setState: React.Dispatch<React.SetStateAction<CurationState>>,
) {
  switch (name) {
    case "curation_started":
      setState((s) => ({
        ...s,
        totalBatches: (data.total_batches as number) ?? 0,
      }));
      break;
    case "batch_processed":
      setState((s) => ({
        ...s,
        batchesProcessed: s.batchesProcessed + 1,
        relationsFound: s.relationsFound + ((data.relations_found as number) ?? 0),
        entitiesCreated: s.entitiesCreated + ((data.entities_created as number) ?? 0),
      }));
      break;
    case "curation_complete":
      setState((s) => ({
        ...s,
        status: "complete",
        relationsFound: (data.total_relations as number) ?? s.relationsFound,
        entitiesCreated: (data.total_entities as number) ?? s.entitiesCreated,
        totalFacts: (data.total_facts as number) ?? 0,
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
