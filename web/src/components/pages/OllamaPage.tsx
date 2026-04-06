import { useState, useEffect, useCallback } from "react";
import { ollamaApi, type OllamaStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

function Bar({ used, total, color = "bg-violet-500" }: { used: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return (
    <div className="h-3 bg-muted rounded-full overflow-hidden">
      <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/50 rounded-lg p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">{label}</div>
      {children}
    </div>
  );
}

export function OllamaPage() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [error, setError] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await ollamaApi.getStatus();
      setStatus(res);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [poll]);

  const gpu = status?.gpu;
  const ram = status?.ram;
  const ollama = status?.ollama;
  const loaded = ollama?.models_loaded ?? [];
  const available = ollama?.models_available ?? [];

  const vramPct = gpu && gpu.vram_total_mb > 0 ? Math.round((gpu.vram_used_mb / gpu.vram_total_mb) * 100) : 0;
  const ramPct = ram && ram.total_mb > 0 ? Math.round((ram.used_mb / ram.total_mb) * 100) : 0;
  const ramFree = ram ? ram.total_mb - ram.used_mb : 0;
  const vramFree = gpu ? gpu.vram_total_mb - gpu.vram_used_mb : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Ollama</h1>
          {ollama && (
            <span className={cn(
              "inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full",
              ollama.running
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-red-500/10 text-red-500",
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full", ollama.running ? "bg-emerald-500" : "bg-red-500")} />
              {ollama.running ? "Running" : "Offline"}
            </span>
          )}
          {error && <span className="text-xs text-red-500">Failed to connect to Studio</span>}
        </div>
        <span className="text-xs text-muted-foreground">Auto-refresh 2s</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* GPU + RAM row */}
        <div className="grid grid-cols-3 gap-4">
          {/* VRAM */}
          <StatCard label={gpu?.gpu_name || "GPU"}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-2xl font-bold tabular-nums">{vramPct}%</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {gpu?.vram_used_mb?.toLocaleString()} / {gpu?.vram_total_mb?.toLocaleString()} MB
              </span>
            </div>
            <Bar used={gpu?.vram_used_mb ?? 0} total={gpu?.vram_total_mb ?? 1} color="bg-violet-500" />
            <div className="text-xs text-muted-foreground mt-1.5">{vramFree.toLocaleString()} MB free</div>
          </StatCard>

          {/* GPU Utilization */}
          <StatCard label="GPU Utilization">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-2xl font-bold tabular-nums">{gpu?.gpu_util_pct ?? 0}%</span>
              <span className="text-xs text-muted-foreground">
                {(gpu?.gpu_util_pct ?? 0) > 80 ? "Heavy load" : (gpu?.gpu_util_pct ?? 0) > 30 ? "Active" : "Idle"}
              </span>
            </div>
            <Bar
              used={gpu?.gpu_util_pct ?? 0}
              total={100}
              color={
                (gpu?.gpu_util_pct ?? 0) > 80 ? "bg-red-500" :
                (gpu?.gpu_util_pct ?? 0) > 50 ? "bg-amber-500" : "bg-emerald-500"
              }
            />
          </StatCard>

          {/* System RAM */}
          <StatCard label="System RAM">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-2xl font-bold tabular-nums">{ramPct}%</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {((ram?.used_mb ?? 0) / 1024).toFixed(1)} / {((ram?.total_mb ?? 0) / 1024).toFixed(1)} GB
              </span>
            </div>
            <Bar
              used={ram?.used_mb ?? 0}
              total={ram?.total_mb ?? 1}
              color={ramPct > 85 ? "bg-red-500" : ramPct > 70 ? "bg-amber-500" : "bg-blue-500"}
            />
            <div className="text-xs text-muted-foreground mt-1.5">{(ramFree / 1024).toFixed(1)} GB free</div>
          </StatCard>
        </div>

        {/* Loaded Models */}
        <StatCard label={`Models Loaded (${loaded.length})`}>
          {loaded.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">
              No models loaded. They load on first request and unload after inactivity.
            </div>
          ) : (
            <div className="space-y-3">
              {loaded.map((m) => {
                const vramModelPct = gpu && gpu.vram_total_mb > 0 ? Math.round((m.vram_mb / gpu.vram_total_mb) * 100) : 0;
                return (
                  <div key={m.name} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="font-mono text-sm font-medium">{m.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{m.parameter_size}</span>
                        <span>{m.quantization}</span>
                        <span>{m.family}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">VRAM:</span>
                      <span className="tabular-nums font-medium">{m.vram_mb.toLocaleString()} MB</span>
                      <span className="text-muted-foreground">({vramModelPct}% of total)</span>
                      <div className="flex-1">
                        <Bar used={m.vram_mb} total={gpu?.vram_total_mb ?? 1} color="bg-violet-400" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </StatCard>

        {/* Available Models */}
        <StatCard label={`Models Available (${available.length})`}>
          {available.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">No models found in Ollama.</div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium text-right">Size</th>
                    <th className="px-3 py-2 font-medium text-right">Params</th>
                    <th className="px-3 py-2 font-medium text-right">Quant</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {available.map((m) => {
                    const isLoaded = loaded.some((l) => l.name === m.name);
                    return (
                      <tr key={m.name} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{m.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{(m.size_mb / 1024).toFixed(1)} GB</td>
                        <td className="px-3 py-2 text-right">{m.parameter_size}</td>
                        <td className="px-3 py-2 text-right">{m.quantization}</td>
                        <td className="px-3 py-2">
                          <span className={cn(
                            "inline-flex items-center gap-1 text-xs",
                            isLoaded ? "text-emerald-500" : "text-muted-foreground",
                          )}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", isLoaded ? "bg-emerald-500" : "bg-muted-foreground/30")} />
                            {isLoaded ? "Loaded" : "Available"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </StatCard>
      </div>
    </div>
  );
}
