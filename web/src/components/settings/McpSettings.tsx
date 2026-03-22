import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SettingsField, NumberField, ToggleField } from "./SettingsField";
import { mcpApi, type AppSettings } from "@/lib/api";
import type { McpServer } from "@/lib/types";

interface McpSettingsProps {
  settings: AppSettings;
  draft: Record<string, Record<string, unknown>>;
  onUpdate: (section: string, key: string, value: unknown) => void;
}

function McpStatusDot({ status }: { status: string }) {
  const color =
    status === "ready" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-zinc-500";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

export function McpSettings({ settings, draft, onUpdate }: McpSettingsProps) {
  const isEnabled = (draft["web_search"]?.["enabled"] as boolean) ?? settings.web_search.enabled;
  const maxResults = (draft["web_search"]?.["max_results"] as number) ?? settings.web_search.max_results;

  // MCP server status
  const [servers, setServers] = useState<McpServer[]>([]);
  const [probing, setProbing] = useState(false);

  // MCP config editor
  const [config, setConfig] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configError, setConfigError] = useState("");

  const loadServers = useCallback(async () => {
    try {
      const res = await mcpApi.getStatus();
      setServers(res.servers);
    } catch {
      // ignore
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await mcpApi.getConfig();
      setConfig(JSON.stringify(res.config, null, 2));
    } catch {
      setConfig('{\n  "mcpServers": {}\n}');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
    loadConfig();
  }, [loadServers, loadConfig]);

  const handleProbe = async () => {
    setProbing(true);
    try {
      const res = await mcpApi.probe();
      setServers(res.servers);
    } catch {
      // ignore
    } finally {
      setProbing(false);
    }
  };

  const handleSaveConfig = async () => {
    setConfigError("");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(config);
    } catch {
      setConfigError("Invalid JSON");
      return;
    }
    setConfigSaving(true);
    try {
      await mcpApi.saveConfig(parsed);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
      await handleProbe();
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setConfigSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Web Search — saved to AVS-Agents settings.toml via main Save */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Web Search</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField
            label="Enabled"
            description="Allow web search via MCP"
            modified={draft["web_search"]?.["enabled"] !== undefined}
          >
            <ToggleField
              value={isEnabled}
              onChange={(v) => onUpdate("web_search", "enabled", v)}
            />
          </SettingsField>

          <SettingsField
            label="Max Results"
            description="Number of search results to fetch"
            modified={draft["web_search"]?.["max_results"] !== undefined}
          >
            <NumberField
              value={maxResults}
              onChange={(v) => onUpdate("web_search", "max_results", v)}
              min={1}
              max={20}
            />
          </SettingsField>
        </CardContent>
      </Card>

      {/* MCP Servers — status */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">MCP Servers</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleProbe}
              disabled={probing}
            >
              <RefreshCw size={14} className={`mr-1 ${probing ? "animate-spin" : ""}`} />
              {probing ? "Probing..." : "Probe"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {servers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No servers configured</p>
          ) : (
            <div className="space-y-1.5">
              {servers.map((s) => (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <McpStatusDot status={s.status} />
                  <span className="font-mono">{s.name}</span>
                  <span className="ml-auto text-muted-foreground">{s.status}</span>
                </div>
              ))}
              {servers.some((s) => s.error) && (
                <div className="mt-1 space-y-0.5">
                  {servers
                    .filter((s) => s.error)
                    .map((s) => (
                      <p key={s.name} className="text-[12px] text-red-400 truncate" title={s.error}>
                        {s.name}: {s.error}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* MCP Configuration — .mcp.json */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">MCP Configuration</CardTitle>
            <div className="flex items-center gap-2">
              {configSaved && <span className="text-xs text-emerald-400">Saved</span>}
              <Button
                size="sm"
                onClick={handleSaveConfig}
                disabled={configSaving || configLoading}
              >
                <Save size={14} className="mr-1" />
                {configSaving ? "Saving..." : "Save Config"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Edit .mcp.json to configure MCP servers. Changes take effect after probing.
          </p>
        </CardHeader>
        <CardContent>
          {configLoading ? (
            <div className="text-sm text-muted-foreground py-4">Loading...</div>
          ) : (
            <textarea
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              spellCheck={false}
              className="w-full h-64 resize-none rounded-md border border-input bg-secondary/50 px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}
          {configError && <p className="text-xs text-red-400 mt-1">{configError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
