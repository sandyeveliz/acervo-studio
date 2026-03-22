import { useState, useEffect, useCallback } from "react";
import { Settings, Save, RotateCcw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { settingsApi, type AppSettings } from "@/lib/api";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { AcervoSettings } from "@/components/settings/AcervoSettings";
import { McpSettings } from "@/components/settings/McpSettings";
import { PromptSettings } from "@/components/settings/PromptSettings";

interface SettingsPageProps {
  onSettingsSaved?: () => void;
}

export function SettingsPage({ onSettingsSaved }: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.get();
      setSettings(data);
      setDraft({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSection = (section: string, key: string, value: unknown) => {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...(prev[section] ?? {}), [key]: value },
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (Object.keys(draft).length === 0) return;
    try {
      setSaving(true);
      setError(null);
      const result = await settingsApi.update(draft);
      setSettings(result.settings);
      setDraft({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSettingsSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const hasDraft = Object.keys(draft).length > 0;

  if (loading || !settings) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Settings size={48} strokeWidth={1.5} className="animate-pulse" />
        <p className="text-sm">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h1 className="text-lg font-medium">Settings</h1>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-destructive-foreground">{error}</span>}
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
          <Button variant="outline" size="sm" onClick={loadSettings} disabled={saving}>
            <RotateCcw size={14} className="mr-1" />
            Reload
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!hasDraft || saving}>
            <Save size={14} className="mr-1" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <Tabs defaultValue="models">
          <TabsList>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="acervo">Acervo</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="mt-4">
            <ModelSettings settings={settings} draft={draft} onUpdate={updateSection} />
          </TabsContent>

          <TabsContent value="acervo" className="mt-4">
            <AcervoSettings settings={settings} draft={draft} onUpdate={updateSection} />
          </TabsContent>

          <TabsContent value="mcp" className="mt-4">
            <McpSettings settings={settings} draft={draft} onUpdate={updateSection} />
          </TabsContent>

          <TabsContent value="prompt" className="mt-4">
            <PromptSettings settings={settings} draft={draft} onUpdate={updateSection} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
