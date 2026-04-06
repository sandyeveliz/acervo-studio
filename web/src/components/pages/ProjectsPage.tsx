import { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderOpen,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  Search,
  Sparkles,
  FileText,
  RefreshCw,
  Circle,
  ChevronRight,
  ChevronDown,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { projectsApi, type Project, type FileStatusItem } from "@/lib/api";
import { useIndexing } from "@/hooks/useIndexing";
import { useCuration } from "@/hooks/useCuration";
import { useSynthesis } from "@/hooks/useSynthesis";
import { useFileStatus } from "@/hooks/useFileStatus";
import { useReindex } from "@/hooks/useReindex";
import { useConfirm } from "@/hooks/useConfirm";
import { useProject } from "@/hooks/useProject";

type ProjectStatus = "unknown" | "checking" | "not_initialized" | "initialized" | "indexed";

export function ProjectsPage() {
  const { projects, activeId, loading: projectsLoading, select: contextSelect, refresh: refreshProjects } = useProject();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState("");

  // Per-project state
  const [statusMap, setStatusMap] = useState<Record<string, ProjectStatus>>({});
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [curatingId, setCuratingId] = useState<string | null>(null);
  const [synthesizingId, setSynthesizingId] = useState<string | null>(null);
  const indexing = useIndexing();
  const curation = useCuration();
  const synthesis = useSynthesis();
  const fileStatus = useFileStatus();
  const reindex = useReindex();
  const { confirm, ConfirmDialog } = useConfirm();

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;

  // Derive status map from projects (context provides the data)
  useEffect(() => {
    const map: Record<string, ProjectStatus> = {};
    for (const p of projects) {
      const hasNodes = (p.nodes ?? 0) > 0;
      if (hasNodes) map[p.id] = "indexed";
      else if (p.initialized) map[p.id] = "initialized";
      else map[p.id] = "not_initialized";
    }
    setStatusMap(map);
  }, [projects]);

  // Reload when indexing or curation completes
  useEffect(() => {
    if (indexing.state.status === "complete" || indexing.state.status === "error") {
      refreshProjects();
    }
  }, [indexing.state.status, refreshProjects]);

  useEffect(() => {
    if (curation.state.status === "complete" || curation.state.status === "error") {
      refreshProjects();
    }
  }, [curation.state.status, refreshProjects]);

  useEffect(() => {
    if (synthesis.state.status === "complete" || synthesis.state.status === "error") {
      refreshProjects();
    }
  }, [synthesis.state.status, refreshProjects]);

  // Auto-refresh file status after reindex completes
  useEffect(() => {
    if (reindex.state.status === "complete" && selectedId) {
      fileStatus.checkStatus(selectedId);
    }
  }, [reindex.state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBrowse() {
    setError("");
    setBrowsing(true);
    try {
      const result = await projectsApi.browse();
      if (result.cancelled || !result.path) return;
      await projectsApi.add(result.name, result.path);
      await refreshProjects();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add project");
    } finally {
      setBrowsing(false);
    }
  }

  function handleIndex(projectId: string) {
    setIndexingId(projectId);
    indexing.reset();
    indexing.startIndexing(projectId);
  }

  function handleCurate(projectId: string) {
    setCuratingId(projectId);
    curation.reset();
    curation.startCuration(projectId);
  }

  function handleSynthesize(projectId: string) {
    setSynthesizingId(projectId);
    synthesis.reset();
    synthesis.startSynthesis(projectId);
  }

  async function handleSelect(id: string) {
    try {
      await contextSelect(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to select project");
    }
  }

  async function handleRemove(id: string) {
    const ok = await confirm({
      title: "Remove project",
      description: "Remove this project from the list? The .acervo/ data will not be deleted.",
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await projectsApi.remove(id);
      if (selectedId === id) {
        setSelectedId(null);
        fileStatus.reset();
      }
      if (indexingId === id) {
        indexing.cancel();
        setIndexingId(null);
      }
      await refreshProjects();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove project");
    }
  }

  if (projectsLoading && projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <FolderOpen size={48} strokeWidth={1.5} className="animate-pulse" />
        <p className="text-sm">Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Left panel: project list */}
      <div className="w-80 border-r border-border shrink-0 flex flex-col h-full">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-semibold">Projects</h1>
            <button
              onClick={handleBrowse}
              disabled={browsing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {browsing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              Add
            </button>
          </div>
          {error && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <FolderOpen size={32} strokeWidth={1.5} />
              <p className="text-xs">No projects yet.</p>
            </div>
          ) : (
            projects.map((p) => {
              const isActive = p.id === activeId;
              const isSelected = p.id === selectedId;
              const status = statusMap[p.id] ?? "unknown";

              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  onDoubleClick={() => handleSelect(p.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 transition-all cursor-pointer",
                    isSelected
                      ? "bg-accent border-primary/40 ring-1 ring-primary/20"
                      : "bg-card border-border hover:border-primary/30",
                    !p.valid && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-xs truncate flex-1">{p.name}</h3>
                    {isActive && (
                      <span className="flex items-center gap-0.5 text-[10px] text-primary font-medium shrink-0">
                        <CheckCircle2 size={10} />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                    {p.path}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {status === "indexed" && (
                      <span className="text-[10px] text-muted-foreground">
                        {p.nodes}n / {p.edges}e
                      </span>
                    )}
                    {status === "initialized" && (
                      <span className="text-[10px] text-muted-foreground/60">Initialized</span>
                    )}
                    {status === "not_initialized" && (
                      <span className="text-[10px] text-amber-500">Not init</span>
                    )}
                    {!p.valid && (
                      <span className="text-[10px] text-amber-500">Path not found</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel: detail view */}
      <div className="flex-1 overflow-y-auto">
        {selectedProject ? (
          <ProjectDetail
            project={selectedProject}
            status={statusMap[selectedProject.id] ?? "unknown"}
            isActive={selectedProject.id === activeId}
            indexing={indexing}
            curation={curation}
            synthesis={synthesis}
            fileStatus={fileStatus}
            reindex={reindex}
            indexingId={indexingId}
            curatingId={curatingId}
            synthesizingId={synthesizingId}
            onSelect={() => handleSelect(selectedProject.id)}
            onInit={async () => {
              try {
                await projectsApi.init(selectedProject.path);
                await refreshProjects();
                setStatusMap((m) => ({ ...m, [selectedProject.id]: "initialized" }));
              } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to initialize");
              }
            }}
            onIndex={() => handleIndex(selectedProject.id)}
            onCurate={() => handleCurate(selectedProject.id)}
            onSynthesize={() => handleSynthesize(selectedProject.id)}
            onRemove={() => handleRemove(selectedProject.id)}
            onCheckStatus={async () => {
              setStatusMap((m) => ({ ...m, [selectedProject.id]: "checking" }));
              try {
                await refreshProjects();
              } catch {
                // Network error — revert to unknown
              }
              // useEffect on [projects] will recompute the correct status
            }}
            onDescriptionSaved={(desc) =>
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === selectedProject.id ? { ...p, description: desc } : p,
                ),
              )
            }
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <FolderOpen size={48} strokeWidth={1.5} />
            <p className="text-sm">Select a project to view details</p>
          </div>
        )}
      </div>
      {ConfirmDialog}
    </div>
  );
}


// ── Project Detail Panel ──

function ProjectDetail({
  project,
  status,
  isActive,
  indexing,
  curation,
  synthesis,
  fileStatus,
  reindex,
  indexingId,
  curatingId,
  synthesizingId,
  onSelect,
  onInit,
  onIndex,
  onCurate,
  onSynthesize,
  onRemove,
  onCheckStatus,
  onDescriptionSaved,
}: {
  project: Project;
  status: ProjectStatus;
  isActive: boolean;
  indexing: ReturnType<typeof useIndexing>;
  curation: ReturnType<typeof useCuration>;
  synthesis: ReturnType<typeof useSynthesis>;
  fileStatus: ReturnType<typeof useFileStatus>;
  reindex: ReturnType<typeof useReindex>;
  indexingId: string | null;
  curatingId: string | null;
  synthesizingId: string | null;
  onSelect: () => void;
  onIndex: () => void;
  onCurate: () => void;
  onSynthesize: () => void;
  onInit: () => void;
  onRemove: () => void;
  onCheckStatus: () => void;
  onDescriptionSaved: (desc: string) => void;
}) {
  const [tab, setTab] = useState<"overview" | "files" | "config">("overview");
  const [ops, setOps] = useState<{
    indexed_at: string | null;
    curated_at: string | null;
    synthesized_at: string | null;
  } | null>(null);

  // Auto-load file status + operations when switching to Indexation tab
  useEffect(() => {
    if (tab === "files" && showFilesTab) {
      if (fileStatus.state.status === "idle") {
        fileStatus.checkStatus(project.id);
      }
      projectsApi.getOperations(project.id).then(setOps).catch(() => {});
    }
  }, [tab, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isIndexing = indexingId === project.id && indexing.state.status === "running";
  const indexComplete = indexingId === project.id && indexing.state.status === "complete";
  const indexError = indexingId === project.id && indexing.state.status === "error";
  const isCurating = curatingId === project.id && curation.state.status === "running";
  const curateComplete = curatingId === project.id && curation.state.status === "complete";
  const curateError = curatingId === project.id && curation.state.status === "error";
  const isSynthesizing = synthesizingId === project.id && synthesis.state.status === "running";
  const synthComplete = synthesizingId === project.id && synthesis.state.status === "complete";
  const synthError = synthesizingId === project.id && synthesis.state.status === "error";

  const hasFileStatus = fileStatus.state.status === "loaded";
  const summary = fileStatus.state.summary;
  const hasStale = summary && (summary.modified > 0 || summary.deleted > 0);
  const showFilesTab = status === "initialized" || status === "indexed";

  return (
    <div className="h-full flex flex-col">
      {/* Header — always visible */}
      <div className="px-6 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{project.name}</h2>
          {isActive ? (
            <span className="flex items-center gap-1 text-xs text-primary font-medium">
              <CheckCircle2 size={12} />
              Active
            </span>
          ) : (
            <button
              onClick={onSelect}
              className="text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              Set Active
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono mt-1">{project.path}</p>
      </div>

      {/* Tab bar */}
      <div className="px-6 flex items-center gap-1 border-b border-border shrink-0">
        <button
          onClick={() => setTab("overview")}
          className={cn(
            "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer",
            tab === "overview"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Overview
        </button>
        {showFilesTab && (
          <button
            onClick={() => setTab("files")}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer flex items-center gap-1.5",
              tab === "files"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Indexation
            {hasFileStatus && summary && summary.new + summary.modified > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 text-[10px] leading-none">
                {summary.new + summary.modified}
              </span>
            )}
          </button>
        )}
        {showFilesTab && (
          <button
            onClick={() => setTab("config")}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer",
              tab === "config"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Config
          </button>
        )}
      </div>

      {/* Tab content — fills remaining space */}
      <div className="flex-1 overflow-y-auto">
        {tab === "overview" && (
          <div className="p-6 space-y-6 max-w-2xl">
            {/* Description */}
            {project.initialized && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2">Description</h3>
                <ProjectDescription
                  projectId={project.id}
                  value={project.description ?? ""}
                  onSaved={onDescriptionSaved}
                />
              </div>
            )}

            {/* Stats */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">Status</h3>
              <div className="flex items-center gap-6 text-xs text-muted-foreground">
                {status === "indexed" && (
                  <>
                    <span>{project.nodes} nodes</span>
                    <span>{project.edges} edges</span>
                  </>
                )}
                {status === "initialized" && <span>Initialized (not yet indexed)</span>}
                {status === "not_initialized" && (
                  <div className="flex items-center gap-3">
                    <span className="text-amber-500">Not initialized</span>
                    <button
                      onClick={onInit}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors cursor-pointer"
                    >
                      <Play size={10} />
                      Initialize
                    </button>
                  </div>
                )}
                {status === "checking" && (
                  <span className="flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" />
                    Checking...
                  </span>
                )}
                <button
                  onClick={onCheckStatus}
                  disabled={status === "checking"}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Search size={10} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="border border-destructive/20 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-destructive">Danger Zone</h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Remove project</p>
                  <p className="text-[11px] text-muted-foreground">
                    Unregister this project from Acervo Studio. The .acervo/ data on disk will not be deleted.
                  </p>
                </div>
                <button
                  onClick={onRemove}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 text-xs font-medium transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "files" && showFilesTab && (
          <div className="p-6 h-full flex flex-col">
            {/* Top bar: actions + summary */}
            <div className="flex items-center gap-2 flex-wrap mb-3 shrink-0">
              <button
                onClick={() => fileStatus.checkStatus(project.id)}
                disabled={fileStatus.state.status === "loading"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                {fileStatus.state.status === "loading" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Search size={12} />
                )}
                Scan Project Files
              </button>

              {hasStale && (
                <button
                  onClick={() => reindex.startReindex(project.id)}
                  disabled={reindex.state.status === "running"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {reindex.state.status === "running" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  Re-index Modified ({summary!.modified + summary!.deleted})
                </button>
              )}

              {!isIndexing && (
                <button
                  onClick={onIndex}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Play size={12} />
                  {status === "indexed" ? "Full Re-index" : "Index All"}
                </button>
              )}
              {status === "indexed" && !isCurating && !isIndexing && (
                <button
                  onClick={onCurate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Sparkles size={12} />
                  Curate
                </button>
              )}
              {status === "indexed" && !isSynthesizing && !isIndexing && !isCurating && (
                <button
                  onClick={onSynthesize}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Sparkles size={12} />
                  Synthesize
                </button>
              )}
            </div>

            {/* Status feedback */}
            <div className="space-y-1 mb-3 shrink-0">
              {reindex.state.status === "running" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={10} className="animate-spin" />
                  Re-indexing {reindex.state.staleCount} file{reindex.state.staleCount !== 1 ? "s" : ""}...
                </div>
              )}
              {reindex.state.status === "complete" && reindex.state.reindexed.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                  <CheckCircle2 size={12} />
                  Re-indexed {reindex.state.reindexed.length} file{reindex.state.reindexed.length !== 1 ? "s" : ""}
                </div>
              )}
              {reindex.state.status === "error" && (
                <p className="text-xs text-destructive">{reindex.state.errorMessage}</p>
              )}
              {isIndexing && <IndexProgress state={indexing.state} />}
              {indexComplete && indexing.state.result && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                  <CheckCircle2 size={12} />
                  Indexed: {indexing.state.result.total_nodes} nodes, {indexing.state.result.total_edges} edges
                  ({indexing.state.result.duration_seconds.toFixed(1)}s)
                </div>
              )}
              {indexError && <p className="text-xs text-destructive">{indexing.state.errorMessage}</p>}
              {isCurating && <CurationProgress state={curation.state} />}
              {curateComplete && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                  <Sparkles size={12} />
                  Curated: {curation.state.relationsFound} relations, {curation.state.entitiesCreated} entities
                  ({curation.state.durationSeconds.toFixed(1)}s)
                </div>
              )}
              {curateError && <p className="text-xs text-destructive">{curation.state.errorMessage}</p>}
              {isSynthesizing && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={10} className="animate-spin" />
                  Synthesizing project understanding...
                </div>
              )}
              {synthComplete && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                  <Sparkles size={12} />
                  Synthesized: {synthesis.state.nodesCreated} summary nodes
                  ({synthesis.state.durationSeconds.toFixed(1)}s)
                </div>
              )}
              {synthError && <p className="text-xs text-destructive">{synthesis.state.errorMessage}</p>}
              {fileStatus.state.status === "error" && (
                <p className="text-xs text-destructive">{fileStatus.state.error}</p>
              )}
            </div>

            {/* Last operation timestamps */}
            {ops && (ops.indexed_at || ops.curated_at || ops.synthesized_at) && (
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground/60 mb-2 shrink-0">
                {ops.indexed_at && <span>Indexed: {new Date(ops.indexed_at).toLocaleString()}</span>}
                {ops.curated_at && <span>Curated: {new Date(ops.curated_at).toLocaleString()}</span>}
                {ops.synthesized_at && <span>Synthesized: {new Date(ops.synthesized_at).toLocaleString()}</span>}
              </div>
            )}

            {/* Summary */}
            {hasFileStatus && summary && (
              <div className="mb-3 shrink-0">
                <FileStatusSummaryBar summary={summary} />
              </div>
            )}

            {/* File tree — takes all remaining space */}
            {hasFileStatus && fileStatus.state.files.length > 0 ? (
              <div className="flex-1 min-h-0">
                <FileStatusList files={fileStatus.state.files} />
              </div>
            ) : fileStatus.state.status === "loading" ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <Loader2 size={32} strokeWidth={1.5} className="animate-spin" />
                <p className="text-xs">Scanning project files...</p>
              </div>
            ) : !hasFileStatus ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <FileText size={32} strokeWidth={1.5} />
                <p className="text-xs">Click &ldquo;Scan Project Files&rdquo; to check indexation status</p>
              </div>
            ) : null}
          </div>
        )}

        {tab === "config" && showFilesTab && (
          <ProjectConfigTab projectId={project.id} />
        )}
      </div>
    </div>
  );
}


// ── File Status Summary Bar ──

function FileStatusSummaryBar({ summary }: { summary: { total: number; indexed: number; modified: number; new: number; deleted: number; unsupported: number } }) {
  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="text-muted-foreground">{summary.total} files</span>
      {summary.indexed > 0 && (
        <span className="flex items-center gap-1 text-emerald-500">
          <Circle size={6} fill="currentColor" />
          {summary.indexed} indexed
        </span>
      )}
      {summary.modified > 0 && (
        <span className="flex items-center gap-1 text-amber-500">
          <Circle size={6} fill="currentColor" />
          {summary.modified} modified
        </span>
      )}
      {summary.new > 0 && (
        <span className="flex items-center gap-1 text-blue-500">
          <Circle size={6} fill="currentColor" />
          {summary.new} not indexed
        </span>
      )}
      {summary.deleted > 0 && (
        <span className="flex items-center gap-1 text-red-500">
          <Circle size={6} fill="currentColor" />
          {summary.deleted} deleted
        </span>
      )}
      {summary.unsupported > 0 && (
        <span className="flex items-center gap-1 text-muted-foreground/50">
          <Circle size={6} fill="currentColor" />
          {summary.unsupported} unsupported
        </span>
      )}
    </div>
  );
}


// ── File Status List (folder-grouped tree) ──

const STATUS_DOT: Record<string, string> = {
  indexed: "text-emerald-500",
  modified: "text-amber-500",
  new: "text-blue-500",
  deleted: "text-red-500",
  unsupported: "text-muted-foreground/40",
};

const STATUS_LABEL: Record<string, string> = {
  indexed: "indexed",
  modified: "modified",
  new: "not indexed",
  deleted: "deleted",
  unsupported: "unsupported",
};

// ── Tree data structure ──

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  files: FileStatusItem[];
}

function buildTree(files: FileStatusItem[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    parts.pop(); // remove filename, keep only folder segments
    let current = root;
    let pathSoFar = "";
    for (const part of parts) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      if (!current.children.has(part)) {
        current.children.set(part, { name: part, path: pathSoFar, children: new Map(), files: [] });
      }
      current = current.children.get(part)!;
    }
    current.files.push(f);
  }
  return root;
}

function countIndexable(node: TreeNode): { indexed: number; total: number } {
  let indexed = 0;
  let total = 0;
  for (const f of node.files) {
    if (f.status !== "unsupported") {
      total++;
      if (f.status === "indexed") indexed++;
    }
  }
  for (const child of node.children.values()) {
    const sub = countIndexable(child);
    indexed += sub.indexed;
    total += sub.total;
  }
  return { indexed, total };
}

function FileStatusList({ files }: { files: FileStatusItem[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = buildTree(files);

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {/* Render root's direct files (if any) */}
        {tree.files.map((f) => (
          <FileRow key={f.path} file={f} depth={0} />
        ))}
        {/* Render root's children */}
        {Array.from(tree.children.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((child) => (
            <FolderNode key={child.path} node={child} depth={0} collapsed={collapsed} onToggle={toggle} />
          ))}
      </div>
    </div>
  );
}

function FolderNode({
  node,
  depth,
  collapsed,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isCollapsed = collapsed.has(node.path);
  const counts = countIndexable(node);
  const hasChildren = node.children.size > 0 || node.files.length > 0;
  const pl = 12 + depth * 16;

  return (
    <>
      <button
        onClick={() => onToggle(node.path)}
        className="flex items-center gap-1.5 w-full pr-3 py-1 hover:bg-muted/40 text-xs transition-colors cursor-pointer border-b border-border/10"
        style={{ paddingLeft: `${pl}px` }}
      >
        {hasChildren ? (
          isCollapsed ? (
            <ChevronRight size={12} className="text-muted-foreground/50 shrink-0" />
          ) : (
            <ChevronDown size={12} className="text-muted-foreground/50 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isCollapsed ? (
          <Folder size={12} className="text-muted-foreground/60 shrink-0" />
        ) : (
          <FolderOpen size={12} className="text-muted-foreground/60 shrink-0" />
        )}
        <span className="font-mono truncate text-left flex-1">{node.name}</span>
        {counts.total > 0 && (
          <span className="text-muted-foreground/50 shrink-0 text-[10px]">
            {counts.indexed}/{counts.total}
          </span>
        )}
      </button>

      {!isCollapsed && (
        <>
          {/* Files in this folder */}
          {node.files.map((f) => (
            <FileRow key={f.path} file={f} depth={depth + 1} />
          ))}
          {/* Subfolders */}
          {Array.from(node.children.values())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <FolderNode key={child.path} node={child} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} />
            ))}
        </>
      )}
    </>
  );
}

function FileRow({ file, depth }: { file: FileStatusItem; depth: number }) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dot = STATUS_DOT[file.status] ?? STATUS_DOT.indexed;
  const label = STATUS_LABEL[file.status] ?? "";
  const pl = 12 + depth * 16 + 16; // extra indent past the chevron

  return (
    <div
      className="flex items-center gap-1.5 pr-3 py-0.5 hover:bg-muted/20 border-b border-border/5"
      style={{ paddingLeft: `${pl}px` }}
    >
      <Circle size={5} fill="currentColor" className={cn(dot, "shrink-0")} />
      <FileText size={11} className="text-muted-foreground/40 shrink-0" />
      <span className={cn(
        "text-xs font-mono truncate flex-1",
        file.status === "unsupported" && "text-muted-foreground/40",
        file.status === "deleted" && "text-red-500 line-through",
      )}>
        {fileName}
      </span>
      {file.status !== "indexed" && (
        <span className={cn("text-[10px] shrink-0", dot)}>{label}</span>
      )}
    </div>
  );
}


// ── Project Description (inline-editable) ──

function ProjectDescription({
  projectId,
  value,
  onSaved,
}: {
  projectId: string;
  value: string;
  onSaved: (desc: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  async function save() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === value) return;
    try {
      await projectsApi.updateDescription(projectId, trimmed);
      onSaved(trimmed);
    } catch {
      setDraft(value);
    }
  }

  if (editing) {
    return (
      <div className="mt-1 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          rows={2}
          className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/50 resize-none"
          placeholder="Project description (used for system prompt context)"
        />
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={save}
            className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
          >
            Save
          </button>
          <button
            onClick={() => { setDraft(value); setEditing(false); }}
            className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (value) {
    return (
      <p
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="text-xs text-muted-foreground/70 mt-1 cursor-pointer hover:text-muted-foreground transition-colors"
        title="Click to edit project description"
      >
        {value}
      </p>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className="flex items-center gap-1.5 mt-1.5 px-2 py-1 text-xs text-muted-foreground/50 hover:text-muted-foreground border border-dashed border-border/50 hover:border-border rounded cursor-pointer transition-colors"
    >
      <Plus size={10} />
      Add description
    </button>
  );
}


// ── Index Progress ──

function IndexProgress({ state }: { state: ReturnType<typeof useIndexing>["state"] }) {
  const pct =
    state.totalFiles > 0
      ? Math.round((state.filesAnalyzed / state.totalFiles) * 100)
      : 0;
  const enrichPct =
    state.totalFiles > 0
      ? Math.round((state.filesEnriched / state.totalFiles) * 100)
      : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={10} className="animate-spin" />
        {state.filesEnriched > 0
          ? `Enriching: ${state.filesEnriched}/${state.totalFiles}`
          : `Analyzing: ${state.filesAnalyzed}/${state.totalFiles}`}
        <span className="ml-auto font-mono">
          {state.filesEnriched > 0 ? enrichPct : pct}%
        </span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${state.filesEnriched > 0 ? enrichPct : pct}%` }}
        />
      </div>
      {state.errors.length > 0 && (
        <div className="text-xs text-amber-500">
          {state.errors.length} warning{state.errors.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}


// ── Curation Progress ──

function CurationProgress({ state }: { state: ReturnType<typeof useCuration>["state"] }) {
  const pct =
    state.totalBatches > 0
      ? Math.round((state.batchesProcessed / state.totalBatches) * 100)
      : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles size={10} className="animate-pulse" />
        Curating: {state.batchesProcessed}/{state.totalBatches} batches
        <span className="ml-auto font-mono">{pct}%</span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {state.relationsFound > 0 && (
        <div className="text-xs text-muted-foreground">
          Found {state.relationsFound} relations, {state.entitiesCreated} entities so far
        </div>
      )}
    </div>
  );
}


// ── Project Config Tab ──

function ConfigField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-muted-foreground w-28 shrink-0">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "flex-1 px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/50",
          mono && "font-mono",
        )}
      />
    </div>
  );
}

function ProjectConfigTab({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<import("@/lib/api").ProjectConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    projectsApi.getConfig(projectId).then(setConfig).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      await projectsApi.updateConfig(projectId, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">Loading config...</span>
      </div>
    );
  }

  if (!config) {
    return <div className="p-6 text-xs text-muted-foreground">Could not load config</div>;
  }

  const update = (section: string, key: string, value: string | number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const s = prev[section as keyof typeof prev];
      if (typeof s === "object" && s !== null) {
        return { ...prev, [section]: { ...s, [key]: value } };
      }
      return { ...prev, [section]: value };
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Project Configuration</h3>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
        >
          {saved ? <CheckCircle2 size={12} /> : saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Model */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</h4>
        <ConfigField label="Name" value={config.model.name} onChange={(v) => update("model", "name", v)} mono />
        <ConfigField label="URL" value={config.model.url} onChange={(v) => update("model", "url", v)} mono placeholder="http://localhost:1234/v1" />
        <ConfigField label="API Key" value={config.model.api_key} onChange={(v) => update("model", "api_key", v)} type="password" />
      </div>

      {/* Embeddings */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Embeddings</h4>
        <ConfigField label="URL" value={config.embeddings.url} onChange={(v) => update("embeddings", "url", v)} mono placeholder="http://localhost:11434" />
        <ConfigField label="Model" value={config.embeddings.model} onChange={(v) => update("embeddings", "model", v)} mono />
      </div>

      {/* Context */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Context</h4>
        <ConfigField label="Max Tokens" value={config.context.max_tokens} onChange={(v) => update("context", "max_tokens", parseInt(v) || 0)} type="number" />
        <ConfigField label="History Window" value={config.context.history_window} onChange={(v) => update("context", "history_window", parseInt(v) || 0)} type="number" />
      </div>

      {/* Indexing */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Indexing</h4>
        <div className="flex items-start gap-3">
          <label className="text-xs text-muted-foreground w-28 shrink-0 pt-1">Extensions</label>
          <input
            value={config.indexing.extensions.join(", ")}
            onChange={(e) => {
              const exts = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              setConfig((prev) => prev ? { ...prev, indexing: { ...prev.indexing, extensions: exts } } : prev);
            }}
            className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background text-foreground font-mono"
            placeholder=".py, .ts, .md, .epub"
          />
        </div>
      </div>

      {/* Proxy */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Proxy</h4>
        <ConfigField label="Port" value={config.proxy.port} onChange={(v) => update("proxy", "port", parseInt(v) || 9470)} type="number" />
        <ConfigField label="Target" value={config.proxy.target} onChange={(v) => update("proxy", "target", v)} mono placeholder="(optional)" />
      </div>
    </div>
  );
}
