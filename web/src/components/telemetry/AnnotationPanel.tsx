import { useState } from "react";
import { Plus, Trash2, Copy } from "lucide-react";

const ENTITY_TYPES = ["person", "organization", "project", "technology", "place", "event", "document", "concept"];
const LAYERS = ["PERSONAL", "UNIVERSAL"];
const SPEAKERS = ["user", "assistant"];
const RELATION_TYPES = [
  "part_of", "created_by", "maintains", "works_at", "member_of",
  "uses_technology", "depends_on", "alternative_to",
  "located_in", "deployed_on", "produces", "serves", "documented_in",
  "participated_in", "triggered_by", "resulted_in",
];

interface Entity { id: string; label: string; type: string; layer: string }
interface Relation { source: string; relation: string; target: string }
interface Fact { entity: string; fact: string; speaker: string }

interface AnnotationPanelProps {
  /** What the stage actually produced (read-only) */
  actual: {
    entities?: { name?: string; label?: string; type: string; layer?: string }[];
    relations?: { source: string; target: string; relation: string }[];
    facts?: { entity: string; fact: string; speaker?: string }[];
  };
  /** Current expected annotation (editable) */
  expected: {
    entities: Entity[];
    relations: Relation[];
    facts: Fact[];
  };
  onChange: (expected: { entities: Entity[]; relations: Relation[]; facts: Fact[] }) => void;
}

function Input({ value, onChange, placeholder, className = "" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`px-1.5 py-0.5 text-xs bg-background border border-border rounded text-foreground ${className}`}
    />
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-1 py-0.5 text-xs bg-background border border-border rounded text-foreground"
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function AnnotationPanel({ actual, expected, onChange }: AnnotationPanelProps) {
  const [tab, setTab] = useState<"entities" | "relations" | "facts">("entities");

  const copyActualToExpected = () => {
    onChange({
      entities: (actual.entities ?? []).map((e) => ({
        id: (e.label || e.name || "").toLowerCase().replace(/\s+/g, "_"),
        label: e.label || e.name || "",
        type: e.type || "concept",
        layer: e.layer || "PERSONAL",
      })),
      relations: (actual.relations ?? []).map((r) => ({
        source: r.source,
        relation: r.relation,
        target: r.target,
      })),
      facts: (actual.facts ?? []).map((f) => ({
        entity: f.entity,
        fact: f.fact,
        speaker: f.speaker || "user",
      })),
    });
  };

  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      {/* Actual (read-only) */}
      <div>
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Actual
        </div>
        <div className="space-y-1 text-xs">
          <div className="text-muted-foreground">
            {(actual.entities?.length ?? 0)} entities, {(actual.relations?.length ?? 0)} relations, {(actual.facts?.length ?? 0)} facts
          </div>
          {actual.entities?.map((e, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
              <span className="font-mono">{e.label || e.name}</span>
              <span className="text-muted-foreground">[{e.type}]</span>
            </div>
          ))}
          {actual.relations?.map((r, i) => (
            <div key={i} className="text-[11px] text-muted-foreground">
              {r.source} → <span className="text-foreground/80">{r.relation}</span> → {r.target}
            </div>
          ))}
          {actual.facts?.map((f, i) => (
            <div key={i} className="text-[11px] text-muted-foreground">
              <span className="text-foreground/80">{f.entity}:</span> {f.fact}
            </div>
          ))}
          {!actual.entities?.length && !actual.relations?.length && !actual.facts?.length && (
            <div className="text-muted-foreground/50 italic">No extraction</div>
          )}
        </div>
      </div>

      {/* Expected (editable) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Expected
          </span>
          <button
            onClick={copyActualToExpected}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
            title="Copy actual → expected"
          >
            <Copy size={10} /> Copy
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 mb-2">
          {(["entities", "relations", "facts"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[10px] px-2 py-0.5 rounded cursor-pointer ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {t} ({expected[t].length})
            </button>
          ))}
        </div>

        {/* Entity rows */}
        {tab === "entities" && (
          <div className="space-y-1">
            {expected.entities.map((e, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input value={e.label} onChange={(v) => {
                  const next = [...expected.entities];
                  next[i] = { ...next[i], label: v, id: v.toLowerCase().replace(/\s+/g, "_") };
                  onChange({ ...expected, entities: next });
                }} placeholder="label" className="flex-1" />
                <Select value={e.type} onChange={(v) => {
                  const next = [...expected.entities];
                  next[i] = { ...next[i], type: v };
                  onChange({ ...expected, entities: next });
                }} options={ENTITY_TYPES} />
                <Select value={e.layer} onChange={(v) => {
                  const next = [...expected.entities];
                  next[i] = { ...next[i], layer: v };
                  onChange({ ...expected, entities: next });
                }} options={LAYERS} />
                <button onClick={() => {
                  onChange({ ...expected, entities: expected.entities.filter((_, j) => j !== i) });
                }} className="text-red-500 hover:text-red-400 cursor-pointer"><Trash2 size={12} /></button>
              </div>
            ))}
            <button onClick={() => {
              onChange({ ...expected, entities: [...expected.entities, { id: "", label: "", type: "concept", layer: "PERSONAL" }] });
            }} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer mt-1">
              <Plus size={10} /> Add entity
            </button>
          </div>
        )}

        {/* Relation rows */}
        {tab === "relations" && (
          <div className="space-y-1">
            {expected.relations.map((r, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input value={r.source} onChange={(v) => {
                  const next = [...expected.relations];
                  next[i] = { ...next[i], source: v };
                  onChange({ ...expected, relations: next });
                }} placeholder="source" className="w-20" />
                <Select value={r.relation} onChange={(v) => {
                  const next = [...expected.relations];
                  next[i] = { ...next[i], relation: v };
                  onChange({ ...expected, relations: next });
                }} options={RELATION_TYPES} />
                <Input value={r.target} onChange={(v) => {
                  const next = [...expected.relations];
                  next[i] = { ...next[i], target: v };
                  onChange({ ...expected, relations: next });
                }} placeholder="target" className="w-20" />
                <button onClick={() => {
                  onChange({ ...expected, relations: expected.relations.filter((_, j) => j !== i) });
                }} className="text-red-500 hover:text-red-400 cursor-pointer"><Trash2 size={12} /></button>
              </div>
            ))}
            <button onClick={() => {
              onChange({ ...expected, relations: [...expected.relations, { source: "", relation: "part_of", target: "" }] });
            }} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer mt-1">
              <Plus size={10} /> Add relation
            </button>
          </div>
        )}

        {/* Fact rows */}
        {tab === "facts" && (
          <div className="space-y-1">
            {expected.facts.map((f, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input value={f.entity} onChange={(v) => {
                  const next = [...expected.facts];
                  next[i] = { ...next[i], entity: v };
                  onChange({ ...expected, facts: next });
                }} placeholder="entity" className="w-20" />
                <Input value={f.fact} onChange={(v) => {
                  const next = [...expected.facts];
                  next[i] = { ...next[i], fact: v };
                  onChange({ ...expected, facts: next });
                }} placeholder="fact text" className="flex-1" />
                <Select value={f.speaker} onChange={(v) => {
                  const next = [...expected.facts];
                  next[i] = { ...next[i], speaker: v };
                  onChange({ ...expected, facts: next });
                }} options={SPEAKERS} />
                <button onClick={() => {
                  onChange({ ...expected, facts: expected.facts.filter((_, j) => j !== i) });
                }} className="text-red-500 hover:text-red-400 cursor-pointer"><Trash2 size={12} /></button>
              </div>
            ))}
            <button onClick={() => {
              onChange({ ...expected, facts: [...expected.facts, { entity: "", fact: "", speaker: "user" }] });
            }} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer mt-1">
              <Plus size={10} /> Add fact
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
