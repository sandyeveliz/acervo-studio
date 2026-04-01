import { useState, useRef, useCallback } from "react";
import { reindexProject } from "@/lib/api";

export interface ReindexState {
  status: "idle" | "running" | "complete" | "error";
  staleCount: number;
  reindexed: string[];
  errorMessage: string | null;
}

const INITIAL_STATE: ReindexState = {
  status: "idle",
  staleCount: 0,
  reindexed: [],
  errorMessage: null,
};

export function useReindex() {
  const [state, setState] = useState<ReindexState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const startReindex = useCallback(async (projectId: string) => {
    setState({ ...INITIAL_STATE, status: "running" });

    const { controller, response: responsePromise } =
      reindexProject(projectId);
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
        setState((s) => ({
          ...s,
          status: "error",
          errorMessage: "No response body",
        }));
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

      setState((s) =>
        s.status === "running" ? { ...s, status: "complete" } : s,
      );
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

  return { state, startReindex, cancel, reset };
}

function handleEvent(
  name: string,
  data: Record<string, unknown>,
  setState: React.Dispatch<React.SetStateAction<ReindexState>>,
) {
  switch (name) {
    case "reindex_started":
      setState((s) => ({
        ...s,
        staleCount: (data.stale_count as number) ?? 0,
      }));
      break;
    case "reindex_complete":
      setState((s) => ({
        ...s,
        status: "complete",
        reindexed: (data.reindexed as string[]) ?? [],
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
      setState((s) =>
        s.status === "running" ? { ...s, status: "complete" } : s,
      );
      break;
  }
}
