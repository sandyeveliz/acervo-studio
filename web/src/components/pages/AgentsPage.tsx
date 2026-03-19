import { useState, useEffect, useCallback } from "react";
import { Bot } from "lucide-react";
import { agentsApi, type AgentSummary } from "@/lib/api";
import { AgentList } from "@/components/agents/AgentList";
import { AgentEditor } from "@/components/agents/AgentEditor";

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAgents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await agentsApi.list();
      setAgents(res.agents);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleCreate = async () => {
    const name = prompt("Agent name:");
    if (!name?.trim()) return;
    const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
    await agentsApi.save(slug, {
      name: slug,
      description: "",
      system_prompt: "",
      temperature: 0.7,
    });
    await loadAgents();
    setSelectedName(slug);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
    await agentsApi.delete(name);
    if (selectedName === name) setSelectedName(null);
    await loadAgents();
  };

  if (loading && agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Bot size={48} strokeWidth={1.5} className="animate-pulse" />
        <p className="text-sm">Loading agents...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-64">
        <AgentList
          agents={agents}
          selectedName={selectedName}
          onSelect={setSelectedName}
          onCreate={handleCreate}
          onDelete={handleDelete}
        />
      </div>
      <div className="flex-1 min-w-0">
        <AgentEditor agentName={selectedName} onSaved={loadAgents} />
      </div>
    </div>
  );
}
