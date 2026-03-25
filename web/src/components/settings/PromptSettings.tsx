import { useState, useEffect } from "react";
import { Save, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SettingsField, ToggleField, NumberField } from "./SettingsField";
import { systemPromptApi, type AppSettings } from "@/lib/api";

interface PromptSettingsProps {
  settings: AppSettings;
  draft: Record<string, Record<string, unknown>>;
  onUpdate: (section: string, key: string, value: unknown) => void;
}

function getVal<T>(
  settings: AppSettings,
  draft: Record<string, Record<string, unknown>>,
  section: string,
  key: string,
  fallback: T,
): T {
  const draftVal = draft[section]?.[key];
  if (draftVal !== undefined) return draftVal as T;
  const sec = settings[section as keyof AppSettings] as Record<string, unknown>;
  return (sec?.[key] as T) ?? fallback;
}

function isModified(
  draft: Record<string, Record<string, unknown>>,
  section: string,
  key: string,
): boolean {
  return draft[section]?.[key] !== undefined;
}

export function PromptSettings({ settings, draft, onUpdate }: PromptSettingsProps) {
  const [prompt, setPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await systemPromptApi.get();
        setPrompt(data.prompt);
        setDefaultPrompt(data.default);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await systemPromptApi.update(prompt);
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setPrompt(defaultPrompt);
    setDirty(true);
    setSaved(false);
  };

  const handleChange = (value: string) => {
    setPrompt(value);
    setDirty(true);
    setSaved(false);
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading prompt...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Assistant Personality — own save via systemPromptApi */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Assistant Personality</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Define tone and personality. Technical instructions (tools, context handling) are managed automatically by Acervo.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {error && <span className="text-xs text-destructive-foreground">{error}</span>}
              {saved && <span className="text-xs text-emerald-400">Saved</span>}
              <Button variant="outline" size="sm" onClick={handleReset} disabled={saving}>
                <RotateCcw size={14} className="mr-1" />
                Reset
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
                <Save size={14} className="mr-1" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <textarea
            value={prompt}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full min-h-[120px] bg-background border border-border rounded-md p-3 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="You are a helpful conversational assistant."
          />
          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span>{prompt.length} characters</span>
            {dirty && <span className="text-amber-400">Unsaved changes</span>}
          </div>
        </CardContent>
      </Card>

      {/* Context behavior — uses draft/onUpdate (saved with main Settings save) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Context &amp; Reasoning</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <SettingsField
            label="History Window"
            description="Messages to keep when graph has context. Older turns are replaced by ranked graph context. Set 0 to disable windowing."
            modified={isModified(draft, "context", "history_window")}
          >
            <NumberField
              value={getVal(settings, draft, "context", "history_window", 2)}
              onChange={(v) => onUpdate("context", "history_window", v)}
              min={0}
              max={50}
            />
          </SettingsField>
          <SettingsField
            label="Plan Mode"
            description="Append step-by-step reasoning instructions to the system prompt"
            modified={isModified(draft, "context", "plan_mode")}
          >
            <ToggleField
              value={getVal(settings, draft, "context", "plan_mode", false)}
              onChange={(v) => onUpdate("context", "plan_mode", v)}
            />
          </SettingsField>
        </CardContent>
      </Card>

      {/* Reference */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">How the system message is composed</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>The system message sent to the LLM is composed from layers:</p>
          <ul className="list-disc ml-4 space-y-0.5">
            <li><code className="text-amber-400/70">── ACERVO INFRA ──</code> — Tool usage, context rules, response behavior (automatic, not editable)</li>
            <li><code className="text-amber-400/70">── USER PROMPT ──</code> — Your personality prompt above</li>
            <li><code className="text-amber-400/70">[VERIFIED CONTEXT]</code> — Enriched data from knowledge graph (injected per-turn)</li>
          </ul>
          <p className="mt-2">Changes take effect on the next message — no restart needed.</p>
        </CardContent>
      </Card>
    </div>
  );
}
