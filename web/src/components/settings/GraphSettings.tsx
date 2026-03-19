import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsField, TextField, NumberField } from "./SettingsField";
import type { AppSettings } from "@/lib/api";

interface GraphSettingsProps {
  settings: AppSettings;
  draft: Record<string, Record<string, unknown>>;
  onUpdate: (section: string, key: string, value: unknown) => void;
}

function getVal<T>(settings: AppSettings, draft: Record<string, Record<string, unknown>>, key: string, fallback: T): T {
  const draftVal = draft["graph"]?.[key];
  if (draftVal !== undefined) return draftVal as T;
  return ((settings.graph as Record<string, unknown>)[key] as T) ?? fallback;
}

function isModified(draft: Record<string, Record<string, unknown>>, key: string): boolean {
  return draft["graph"]?.[key] !== undefined;
}

export function GraphSettings({ settings, draft, onUpdate }: GraphSettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Graph Storage</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField label="Persist Path" description="Where graph data is stored (read-only)">
            <TextField value={settings.graph.persist_path} onChange={() => {}} />
          </SettingsField>

          <SettingsField
            label="Merge Similarity Threshold"
            description="Threshold for deduplicating similar nodes (0-1)"
            modified={isModified(draft, "merge_similarity_threshold")}
          >
            <NumberField
              value={getVal(settings, draft, "merge_similarity_threshold", 0.85)}
              onChange={(v) => onUpdate("graph", "merge_similarity_threshold", v)}
              min={0.5}
              max={1.0}
              step={0.05}
            />
          </SettingsField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Routing</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField
            label="Max Local Latency (ms)"
            description="Latency threshold for local vs remote routing"
            modified={draft["routing"]?.["max_local_latency_ms"] !== undefined}
          >
            <NumberField
              value={(draft["routing"]?.["max_local_latency_ms"] as number) ?? settings.routing.max_local_latency_ms}
              onChange={(v) => onUpdate("routing", "max_local_latency_ms", v)}
              min={500}
              max={30000}
              step={500}
            />
          </SettingsField>
        </CardContent>
      </Card>
    </div>
  );
}
