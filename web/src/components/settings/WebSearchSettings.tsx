import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsField, NumberField, ToggleField } from "./SettingsField";
import type { AppSettings } from "@/lib/api";

interface WebSearchSettingsProps {
  settings: AppSettings;
  draft: Record<string, Record<string, unknown>>;
  onUpdate: (section: string, key: string, value: unknown) => void;
}

export function WebSearchSettings({ settings, draft, onUpdate }: WebSearchSettingsProps) {
  const isEnabled = (draft["web_search"]?.["enabled"] as boolean) ?? settings.web_search.enabled;
  const maxResults = (draft["web_search"]?.["max_results"] as number) ?? settings.web_search.max_results;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Web Search (Brave)</CardTitle>
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
  );
}
