import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { SettingsField, TextField, NumberField } from "@/components/settings/SettingsField";
import { agentsApi, type AgentConfig } from "@/lib/api";

interface AgentEditorProps {
  agentName: string | null;
  onSaved: () => void;
}

export function AgentEditor({ agentName, onSaved }: AgentEditorProps) {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!agentName) {
      setConfig(null);
      return;
    }
    setLoading(true);
    agentsApi.get(agentName)
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [agentName]);

  const handleSave = async () => {
    if (!config || !agentName) return;
    setSaving(true);
    try {
      await agentsApi.save(agentName, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (!agentName) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select an agent to edit
      </div>
    );
  }

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-sm font-medium">{agentName}</h3>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <SettingsField label="Name">
              <TextField
                value={config.name}
                onChange={(v) => setConfig({ ...config, name: v })}
              />
            </SettingsField>
            <SettingsField label="Description">
              <TextField
                value={config.description}
                onChange={(v) => setConfig({ ...config, description: v })}
              />
            </SettingsField>
            <SettingsField label="Temperature" description="0 = deterministic, 1 = creative">
              <NumberField
                value={config.temperature}
                onChange={(v) => setConfig({ ...config, temperature: v })}
                min={0}
                max={2}
                step={0.1}
              />
            </SettingsField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">System Prompt</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={config.system_prompt}
              onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
              rows={12}
              className="w-full rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm font-mono resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
