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
            <Badge variant="outline" className="text-[12px]">Restart required</Badge>
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
          <CardTitle className="text-sm">Context Window Budget</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField
            label="Hot Layer Max Messages"
            description="Recent conversation turns to keep"
            modified={isModified(draft, "context", "hot_layer_max_messages")}
          >
            <NumberField
              value={getVal(settings, draft, "context", "hot_layer_max_messages", 2)}
              onChange={(v) => onUpdate("context", "hot_layer_max_messages", v)}
              min={0}
              max={10}
            />
          </SettingsField>

          <SettingsField
            label="Hot Layer Max Tokens"
            description="Token budget for recent messages"
            modified={isModified(draft, "context", "hot_layer_max_tokens")}
          >
            <NumberField
              value={getVal(settings, draft, "context", "hot_layer_max_tokens", 500)}
              onChange={(v) => onUpdate("context", "hot_layer_max_tokens", v)}
              min={100}
              max={4000}
              step={100}
            />
          </SettingsField>

          <SettingsField
            label="Warm Layer Max Tokens"
            description="Token budget for graph context"
            modified={isModified(draft, "context", "warm_layer_max_tokens")}
          >
            <NumberField
              value={getVal(settings, draft, "context", "warm_layer_max_tokens", 800)}
              onChange={(v) => onUpdate("context", "warm_layer_max_tokens", v)}
              min={200}
              max={4000}
              step={100}
            />
          </SettingsField>

          <SettingsField
            label="Topic Change Threshold"
            description="Embedding similarity threshold for topic changes (0-1)"
            modified={isModified(draft, "context", "topic_change_embed_threshold")}
          >
            <NumberField
              value={getVal(settings, draft, "context", "topic_change_embed_threshold", 0.65)}
              onChange={(v) => onUpdate("context", "topic_change_embed_threshold", v)}
              min={0.1}
              max={1.0}
              step={0.05}
            />
          </SettingsField>

          <SettingsField
            label="Compaction Trigger Tokens"
            description="Total budget target for the context stack"
            modified={isModified(draft, "context", "compaction_trigger_tokens")}
          >
            <NumberField
              value={getVal(settings, draft, "context", "compaction_trigger_tokens", 2000)}
              onChange={(v) => onUpdate("context", "compaction_trigger_tokens", v)}
              min={500}
              max={8000}
              step={100}
            />
          </SettingsField>
        </CardContent>
      </Card>

    </div>
  );
}
