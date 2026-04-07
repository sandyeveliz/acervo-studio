import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { SettingsField, TextField } from "@/components/settings/SettingsField";
import { skillsApi, type SkillConfig } from "@/lib/api";

interface SkillEditorProps {
  skillName: string | null;
  onSaved: () => void;
}

export function SkillEditor({ skillName, onSaved }: SkillEditorProps) {
  const [config, setConfig] = useState<SkillConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!skillName) {
      setConfig(null);
      return;
    }
    setLoading(true);
    skillsApi.get(skillName)
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [skillName]);

  const handleSave = async () => {
    if (!config || !skillName) return;
    setSaving(true);
    try {
      await skillsApi.save(skillName, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (!skillName) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a skill to edit
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
        <h3 className="text-sm font-medium">{skillName}</h3>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Content</CardTitle>
            <p className="text-xs text-muted-foreground">
              Markdown content that defines this skill's knowledge and rules.
            </p>
          </CardHeader>
          <CardContent>
            <textarea
              value={config.content}
              onChange={(e) => setConfig({ ...config, content: e.target.value })}
              rows={16}
              className="w-full rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm font-mono resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="# Skill Name&#10;&#10;Rules, patterns, and knowledge for this skill..."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
