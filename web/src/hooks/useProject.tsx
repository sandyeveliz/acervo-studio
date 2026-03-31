import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { projectsApi, type Project, type ProjectsResponse } from "@/lib/api";

interface ProjectState {
  projects: Project[];
  activeId: string | null;
  loading: boolean;
  switching: boolean;
  error: string | null;
}

interface ProjectContextValue extends ProjectState {
  activeProject: Project | undefined;
  /** Select a project by ID. Returns when switch is complete. */
  select: (id: string) => Promise<void>;
  /** Refresh the project list from backend. */
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProjectState>({
    projects: [],
    activeId: sessionStorage.getItem("active_project_id"),
    loading: true,
    switching: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const data: ProjectsResponse = await projectsApi.list();
      setState((prev) => ({
        ...prev,
        projects: data.projects,
        activeId: data.active,
        loading: false,
        error: null,
      }));
      if (data.active) sessionStorage.setItem("active_project_id", data.active);
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  const select = useCallback(
    async (id: string) => {
      setState((prev) => ({ ...prev, switching: true, error: null }));
      try {
        await projectsApi.select(id);
        // Single refresh after select — replaces the old 2-4 cascading API calls
        const data: ProjectsResponse = await projectsApi.list();
        setState({
          projects: data.projects,
          activeId: data.active,
          loading: false,
          switching: false,
          error: null,
        });
        if (data.active)
          sessionStorage.setItem("active_project_id", data.active);
      } catch (e: unknown) {
        setState((prev) => ({
          ...prev,
          switching: false,
          error: e instanceof Error ? e.message : "Failed to switch project",
        }));
      }
    },
    [],
  );

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeProject = state.projects.find((p) => p.id === state.activeId);

  return (
    <ProjectContext.Provider
      value={{ ...state, activeProject, select, refresh }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx)
    throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
