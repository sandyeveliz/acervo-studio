import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsField, NumberField } from "./SettingsField";
import type { AppSettings } from "@/lib/api";

interface ContextSettingsProps {
  settings: AppSettings;
  draft: Record<string, Record<string, unknown>>;
  onUpdate: (section: string, key: string, value: unknown) => void;
}

function getVal<T>(settings: AppSettings, draft: Record<string, Record<string, unknown>>, key: string, fallback: T): T {
  const draftVal = draft["context"]?.[key];
  if (draftVal !== undefined) return draftVal as T;
  return ((settings.context as Record<string, unknown>)[key] as T) ?? fallback;
}

function isModified(draft: Record<string, Record<string, unknown>>, key: string): boolean {
  return draft["context"]?.[key] !== undefined;
}

export function ContextSettings({ settings, draft, onUpdate }: ContextSettingsProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Context Window Budget</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        <SettingsField
          label="Hot Layer Max Messages"
          description="Recent conversation turns to keep"
          modified={isModified(draft, "hot_layer_max_messages")}
        >
          <NumberField
            value={getVal(settings, draft, "hot_layer_max_messages", 2)}
            onChange={(v) => onUpdate("context", "hot_layer_max_messages", v)}
            min={0}
            max={10}
          />
        </SettingsField>

        <SettingsField
          label="Hot Layer Max Tokens"
          description="Token budget for recent messages"
          modified={isModified(draft, "hot_layer_max_tokens")}
        >
          <NumberField
            value={getVal(settings, draft, "hot_layer_max_tokens", 500)}
            onChange={(v) => onUpdate("context", "hot_layer_max_tokens", v)}
            min={100}
            max={4000}
            step={100}
          />
        </SettingsField>

        <SettingsField
          label="Warm Layer Max Tokens"
          description="Token budget for graph context"
          modified={isModified(draft, "warm_layer_max_tokens")}
        >
          <NumberField
            value={getVal(settings, draft, "warm_layer_max_tokens", 800)}
            onChange={(v) => onUpdate("context", "warm_layer_max_tokens", v)}
            min={200}
            max={4000}
            step={100}
          />
        </SettingsField>

        <SettingsField
          label="Topic Change Threshold"
          description="Embedding similarity threshold for topic changes (0-1)"
          modified={isModified(draft, "topic_change_embed_threshold")}
        >
          <NumberField
            value={getVal(settings, draft, "topic_change_embed_threshold", 0.65)}
            onChange={(v) => onUpdate("context", "topic_change_embed_threshold", v)}
            min={0.1}
            max={1.0}
            step={0.05}
          />
        </SettingsField>

        <SettingsField
          label="Compaction Trigger Tokens"
          description="Total budget target for the context stack"
          modified={isModified(draft, "compaction_trigger_tokens")}
        >
          <NumberField
            value={getVal(settings, draft, "compaction_trigger_tokens", 2000)}
            onChange={(v) => onUpdate("context", "compaction_trigger_tokens", v)}
            min={500}
            max={8000}
            step={100}
          />
        </SettingsField>
      </CardContent>
    </Card>
  );
}
