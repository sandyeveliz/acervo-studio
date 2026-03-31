import { useState, useCallback } from "react";
import { projectsApi } from "@/lib/api";
import type { FileStatusItem, FileStatusSummary } from "@/lib/api";

export interface FileStatusState {
  status: "idle" | "loading" | "loaded" | "error";
  files: FileStatusItem[];
  summary: FileStatusSummary | null;
  error: string | null;
}

const INITIAL_STATE: FileStatusState = {
  status: "idle",
  files: [],
  summary: null,
  error: null,
};

export function useFileStatus() {
  const [state, setState] = useState<FileStatusState>(INITIAL_STATE);

  const checkStatus = useCallback(async (projectId: string) => {
    setState({ ...INITIAL_STATE, status: "loading" });
    try {
      const data = await projectsApi.getFileStatus(projectId);
      setState({
        status: "loaded",
        files: data.files,
        summary: data.summary,
        error: null,
      });
    } catch (e) {
      setState({
        ...INITIAL_STATE,
        status: "error",
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, checkStatus, reset };
}
