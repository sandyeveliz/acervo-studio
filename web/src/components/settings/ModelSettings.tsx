import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingsField, TextField, NumberField, ToggleField } from "./SettingsField";
import type { AppSettings } from "@/lib/api";

interface ModelSettingsProps {
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

export function ModelSettings({ settings, draft, onUpdate }: ModelSettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Main Model (Chat)
            <Badge variant="outline" className="text-[10px]">Restart required</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField label="Base URL" description="LM Studio API endpoint" modified={isModified(draft, "lmstudio", "base_url")}>
            <TextField
              value={getVal(settings, draft, "lmstudio", "base_url", "")}
              onChange={(v) => onUpdate("lmstudio", "base_url", v)}
            />
          </SettingsField>
          <SettingsField label="Model" description="Model name/path" modified={isModified(draft, "lmstudio", "model")}>
            <TextField
              value={getVal(settings, draft, "lmstudio", "model", "")}
              onChange={(v) => onUpdate("lmstudio", "model", v)}
            />
          </SettingsField>
          <SettingsField label="Context Window" modified={isModified(draft, "lmstudio", "context_window")}>
            <NumberField
              value={getVal(settings, draft, "lmstudio", "context_window", 32000)}
              onChange={(v) => onUpdate("lmstudio", "context_window", v)}
              min={1024}
              max={131072}
              step={1024}
            />
          </SettingsField>
          <SettingsField label="KV Cache" description="Enable prefix caching for system prompt" modified={isModified(draft, "lmstudio", "kv_cache")}>
            <ToggleField
              value={getVal(settings, draft, "lmstudio", "kv_cache", true)}
              onChange={(v) => onUpdate("lmstudio", "kv_cache", v)}
            />
          </SettingsField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Utility Model (Extraction/Planning)
            <Badge variant="outline" className="text-[10px]">Restart required</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField label="Base URL" modified={isModified(draft, "lmstudio_utility", "base_url")}>
            <TextField
              value={getVal(settings, draft, "lmstudio_utility", "base_url", "")}
              onChange={(v) => onUpdate("lmstudio_utility", "base_url", v)}
            />
          </SettingsField>
          <SettingsField label="Model" modified={isModified(draft, "lmstudio_utility", "model")}>
            <TextField
              value={getVal(settings, draft, "lmstudio_utility", "model", "")}
              onChange={(v) => onUpdate("lmstudio_utility", "model", v)}
            />
          </SettingsField>
          <SettingsField label="Context Window" modified={isModified(draft, "lmstudio_utility", "context_window")}>
            <NumberField
              value={getVal(settings, draft, "lmstudio_utility", "context_window", 32000)}
              onChange={(v) => onUpdate("lmstudio_utility", "context_window", v)}
              min={1024}
              max={131072}
              step={1024}
            />
          </SettingsField>
          <SettingsField label="KV Cache" modified={isModified(draft, "lmstudio_utility", "kv_cache")}>
            <ToggleField
              value={getVal(settings, draft, "lmstudio_utility", "kv_cache", false)}
              onChange={(v) => onUpdate("lmstudio_utility", "kv_cache", v)}
            />
          </SettingsField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ollama (Embeddings)</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField label="Base URL" modified={isModified(draft, "ollama", "base_url")}>
            <TextField
              value={getVal(settings, draft, "ollama", "base_url", "")}
              onChange={(v) => onUpdate("ollama", "base_url", v)}
            />
          </SettingsField>
          <SettingsField label="Embed Model" modified={isModified(draft, "ollama", "embed_model")}>
            <TextField
              value={getVal(settings, draft, "ollama", "embed_model", "")}
              onChange={(v) => onUpdate("ollama", "embed_model", v)}
            />
          </SettingsField>
        </CardContent>
      </Card>
    </div>
  );
}
