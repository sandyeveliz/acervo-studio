import { useState, useEffect, useCallback } from "react";
import { Sparkles } from "lucide-react";
import { skillsApi, type SkillSummary } from "@/lib/api";
import { SkillList } from "@/components/skills/SkillList";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { InstallSkillDialog } from "@/components/skills/InstallSkillDialog";
import { useConfirm } from "@/hooks/useConfirm";
import { usePrompt } from "@/hooks/usePrompt";

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installOpen, setInstallOpen] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();
  const { prompt, PromptDialog } = usePrompt();

  const loadSkills = useCallback(async () => {
    try {
      setLoading(true);
      const res = await skillsApi.list();
      setSkills(res.skills);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleCreate = async () => {
    const name = await prompt({
      title: "New Skill",
      description: "Enter a name for the new skill.",
      placeholder: "my-skill",
    });
    if (!name) return;
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    await skillsApi.save(slug, {
      name: slug,
      description: "",
      content: "",
    });
    await loadSkills();
    setSelectedName(slug);
  };

  const handleDelete = async (name: string) => {
    const ok = await confirm({
      title: "Delete skill",
      description: `Delete skill "${name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    await skillsApi.delete(name);
    if (selectedName === name) setSelectedName(null);
    await loadSkills();
  };

  if (loading && skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Sparkles size={48} strokeWidth={1.5} className="animate-pulse" />
        <p className="text-sm">Loading skills...</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full">
        <div className="w-64">
          <SkillList
            skills={skills}
            selectedName={selectedName}
            onSelect={setSelectedName}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onInstall={() => setInstallOpen(true)}
          />
        </div>
        <div className="flex-1 min-w-0">
          <SkillEditor skillName={selectedName} onSaved={loadSkills} />
        </div>
      </div>
      <InstallSkillDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstalled={loadSkills}
      />
      {ConfirmDialog}
      {PromptDialog}
    </>
  );
}
