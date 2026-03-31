import { useState, useRef, useCallback } from "react";
import { indexProject } from "@/lib/api";

export interface IndexingState {
  status: "idle" | "running" | "complete" | "error";
  totalFiles: number;
  filesAnalyzed: number;
  filesEnriched: number;
  currentFile: string;
  errors: string[];
  result: {
    files_analyzed: number;
    files_enriched: number;
    total_nodes: number;
    total_edges: number;
    total_chunks: number;
    duration_seconds: number;
  } | null;
  errorMessage: string | null;
}

const INITIAL_STATE: IndexingState = {
  status: "idle",
  totalFiles: 0,
  filesAnalyzed: 0,
  filesEnriched: 0,
  currentFile: "",
  errors: [],
  result: null,
  errorMessage: null,
};

export function useIndexing() {
  const [state, setState] = useState<IndexingState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const startIndexing = useCallback(
    async (projectId: string, structuralOnly = false) => {
      // Reset state
      setState({ ...INITIAL_STATE, status: "running" });

      const { controller, response: responsePromise } = indexProject(
        projectId,
        structuralOnly,
      );
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

          // Parse SSE lines
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

        // Finalize: if still running, mark complete
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
    },
    [],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState((s) => ({ ...s, status: "idle" }));
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, startIndexing, cancel, reset };
}

function handleEvent(
  name: string,
  data: Record<string, unknown>,
  setState: React.Dispatch<React.SetStateAction<IndexingState>>,
) {
  switch (name) {
    case "indexing_started":
      setState((s) => ({
        ...s,
        totalFiles: (data.total_files as number) ?? 0,
      }));
      break;
    case "file_analyzed":
      setState((s) => ({
        ...s,
        filesAnalyzed: s.filesAnalyzed + 1,
        currentFile: (data.file_path as string) ?? "",
      }));
      break;
    case "file_enriched":
      setState((s) => ({
        ...s,
        filesEnriched: s.filesEnriched + 1,
        currentFile: (data.file_path as string) ?? "",
      }));
      break;
    case "file_indexed":
      // Just a progress marker — no state change needed
      break;
    case "indexing_error":
      setState((s) => ({
        ...s,
        errors: [...s.errors, `${data.file_path}: ${data.error}`],
      }));
      break;
    case "indexing_complete":
      setState((s) => ({
        ...s,
        status: "complete",
        result: {
          files_analyzed: (data.total_files as number) ?? s.filesAnalyzed,
          files_enriched: s.filesEnriched,
          total_nodes: (data.total_nodes as number) ?? 0,
          total_edges: (data.total_edges as number) ?? 0,
          total_chunks: 0,
          duration_seconds: (data.duration_seconds as number) ?? 0,
        },
      }));
      break;
    case "indexing_result":
      setState((s) => ({
        ...s,
        status: "complete",
        result: {
          files_analyzed: (data.files_analyzed as number) ?? s.filesAnalyzed,
          files_enriched: (data.files_enriched as number) ?? s.filesEnriched,
          total_nodes: (data.total_nodes as number) ?? 0,
          total_edges: (data.total_edges as number) ?? 0,
          total_chunks: (data.total_chunks as number) ?? 0,
          duration_seconds: (data.duration_seconds as number) ?? 0,
        },
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
      // Stream finished — state should already be set by indexing_result/indexing_complete
      setState((s) =>
        s.status === "running" ? { ...s, status: "complete" } : s,
      );
      break;
  }
}
