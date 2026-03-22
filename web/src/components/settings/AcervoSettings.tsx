import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsField, TextField, NumberField, ToggleField } from "./SettingsField";
import { Button } from "@/components/ui/button";
import { acervoApi, type AppSettings, type AcervoConfigData } from "@/lib/api";

interface AcervoSettingsProps {
  settings: AppSettings;
  draft: Record<string, Record<string, unknown>>;
  onUpdate: (section: string, key: string, value: unknown) => void;
}

function getVal<T>(settings: AppSettings, draft: Record<string, Record<string, unknown>>, section: string, key: string, fallback: T): T {
  const draftVal = draft[section]?.[key];
  if (draftVal !== undefined) return draftVal as T;
  const sec = settings[section as keyof AppSettings] as Record<string, unknown>;
  return (sec?.[key] as T) ?? fallback;
}

function isModified(draft: Record<string, Record<string, unknown>>, section: string, key: string): boolean {
  return draft[section]?.[key] !== undefined;
}

export function AcervoSettings({ settings, draft, onUpdate }: AcervoSettingsProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [acervoConfig, setAcervoConfig] = useState<AcervoConfigData | null>(null);
  const [acervoDraft, setAcervoDraft] = useState<Record<string, Record<string, unknown>>>({});
  const [savingAcervo, setSavingAcervo] = useState(false);
  const [acervoSaved, setAcervoSaved] = useState(false);

  // Plugin settings (AVS-Agents settings.toml)
  const pluginDraft = draft["plugins"]?.["acervo"] as Record<string, unknown> | undefined;
  const isEnabled = (pluginDraft?.["enabled"] as boolean) ?? settings.plugins.acervo.enabled;
  const proxyUrl = (pluginDraft?.["proxy_url"] as string) ?? settings.plugins.acervo.proxy_url;
  const acervoDir = (pluginDraft?.["acervo_dir"] as string) ?? settings.plugins.acervo.acervo_dir;

  const updatePlugin = (key: string, value: unknown) => {
    const current = (draft["plugins"]?.["acervo"] as Record<string, unknown>) ?? {};
    onUpdate("plugins", "acervo", { ...current, [key]: value });
  };

  // Load Acervo config from .acervo/config.toml
  const loadAcervoConfig = useCallback(async () => {
    try {
      const cfg = await acervoApi.getConfig();
      setAcervoConfig(cfg);
    } catch {
      setAcervoConfig(null);
    }
  }, []);

  useEffect(() => {
    loadAcervoConfig();
  }, [loadAcervoConfig]);

  // Acervo config helpers
  const getAcervoVal = (section: string, key: string, fallback: string): string => {
    const draftVal = acervoDraft[section]?.[key];
    if (draftVal !== undefined) return String(draftVal);
    const cfg = acervoConfig as Record<string, unknown> | null;
    const sectionData = cfg?.[section] as Record<string, unknown> | undefined;
    return String(sectionData?.[key] ?? fallback);
  };

  const updateAcervo = (section: string, key: string, value: unknown) => {
    setAcervoDraft((prev) => ({
      ...prev,
      [section]: { ...(prev[section] ?? {}), [key]: value },
    }));
    setAcervoSaved(false);
  };

  const isAcervoModified = (section: string, key: string): boolean => {
    return acervoDraft[section]?.[key] !== undefined;
  };

  const hasAcervoDraft = Object.keys(acervoDraft).length > 0;

  const handleSaveAcervoConfig = async () => {
    if (!hasAcervoDraft) return;
    setSavingAcervo(true);
    try {
      await acervoApi.updateConfig(acervoDraft);
      setAcervoDraft({});
      setAcervoSaved(true);
      setTimeout(() => setAcervoSaved(false), 2000);
      await loadAcervoConfig();
    } catch {
      // ignore
    } finally {
      setSavingAcervo(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await acervoApi.testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Plugin toggle — saved to AVS-Agents settings.toml */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Acervo Plugin</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            When enabled, LLM calls route through the Acervo proxy for context enrichment from the knowledge graph.
          </p>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField
            label="Enabled"
            description="Route LLM calls through Acervo proxy"
            modified={pluginDraft?.["enabled"] !== undefined}
          >
            <ToggleField
              value={isEnabled}
              onChange={(v) => updatePlugin("enabled", v)}
            />
          </SettingsField>

          <SettingsField
            label="Proxy URL"
            description="Acervo proxy endpoint (acervo serve)"
            modified={pluginDraft?.["proxy_url"] !== undefined}
          >
            <TextField
              value={proxyUrl}
              onChange={(v) => updatePlugin("proxy_url", v)}
              placeholder="http://localhost:9470/v1"
            />
          </SettingsField>

          <SettingsField
            label="Acervo Directory"
            description="Path to .acervo/ folder"
            modified={pluginDraft?.["acervo_dir"] !== undefined}
          >
            <TextField
              value={acervoDir}
              onChange={(v) => updatePlugin("acervo_dir", v)}
              placeholder=".acervo"
            />
          </SettingsField>

          <div className="py-3 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            {testResult && (
              <span className={`text-xs ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                {testResult.ok ? "\u2713" : "\u2717"} {testResult.message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Routing — saved to AVS-Agents settings.toml */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Routing</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField
            label="Max Local Latency (ms)"
            description="Latency threshold for local vs remote routing"
            modified={isModified(draft, "routing", "max_local_latency_ms")}
          >
            <NumberField
              value={getVal(settings, draft, "routing", "max_local_latency_ms", 3000)}
              onChange={(v) => onUpdate("routing", "max_local_latency_ms", v)}
              min={500}
              max={30000}
              step={500}
            />
          </SettingsField>
        </CardContent>
      </Card>

      {/* Acervo config — saved to .acervo/config.toml */}
      {acervoConfig?.initialized && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Acervo Configuration</CardTitle>
              <div className="flex items-center gap-2">
                {acervoSaved && <span className="text-xs text-emerald-400">Saved</span>}
                <Button
                  size="sm"
                  onClick={handleSaveAcervoConfig}
                  disabled={!hasAcervoDraft || savingAcervo}
                >
                  {savingAcervo ? "Saving..." : "Save Acervo Config"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              These settings are written to .acervo/config.toml and used by the Acervo proxy.
            </p>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {/* Utility Model */}
            <div className="py-2">
              <p className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">
                Utility Model (Extraction/Planning)
              </p>
            </div>
            <SettingsField label="URL" modified={isAcervoModified("model", "url")}>
              <TextField
                value={getAcervoVal("model", "url", "")}
                onChange={(v) => updateAcervo("model", "url", v)}
                placeholder="http://localhost:1234/v1"
              />
            </SettingsField>
            <SettingsField label="Model" modified={isAcervoModified("model", "name")}>
              <TextField
                value={getAcervoVal("model", "name", "")}
                onChange={(v) => updateAcervo("model", "name", v)}
                placeholder="qwen2.5-3b-instruct"
              />
            </SettingsField>

            {/* Embeddings */}
            <div className="py-2">
              <p className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">
                Embeddings (Topic Detection)
              </p>
            </div>
            <SettingsField
              label="URL"
              description="Ollama or OpenAI-compatible embeddings endpoint"
              modified={isAcervoModified("embeddings", "url")}
            >
              <TextField
                value={getAcervoVal("embeddings", "url", "")}
                onChange={(v) => updateAcervo("embeddings", "url", v)}
                placeholder="http://localhost:11434"
              />
            </SettingsField>
            <SettingsField label="Model" modified={isAcervoModified("embeddings", "model")}>
              <TextField
                value={getAcervoVal("embeddings", "model", "")}
                onChange={(v) => updateAcervo("embeddings", "model", v)}
                placeholder="qwen3-embedding"
              />
            </SettingsField>
          </CardContent>
        </Card>
      )}

      {!acervoConfig?.initialized && (
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">
              No .acervo/ directory found. Run <code className="text-foreground">acervo init</code> in your project to configure.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
