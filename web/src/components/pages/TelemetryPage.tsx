import { useState, useEffect, useCallback } from "react";
import {
  telemetryApi, traceApi, annotationApi,
  type TelemetrySpan, type TraceEvent, type Annotation,
} from "@/lib/api";
import { TurnList } from "@/components/telemetry/TurnList";
import { TurnDetail } from "@/components/telemetry/TurnDetail";

const RANGE_OPTIONS = [
  { label: "Last 10", value: 10 },
  { label: "Last 25", value: 25 },
  { label: "Last 50", value: 50 },
  { label: "All", value: 0 },
] as const;

export function TelemetryPage() {
  const [spans, setSpans] = useState<TelemetrySpan[]>([]);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [annotations, setAnnotations] = useState<Record<number, Annotation>>({});
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [range, setRange] = useState(25);

  const fetchData = useCallback(async () => {
    try {
      const [telRes, traceRes, annRes] = await Promise.all([
        telemetryApi.get(range || undefined),
        traceApi.getEvents(),
        annotationApi.getAll(),
      ]);
      setSpans(telRes.spans);
      setTraceEvents(traceRes.events);
      // Convert string keys to number keys
      const annMap: Record<number, Annotation> = {};
      for (const [k, v] of Object.entries(annRes.annotations)) {
        annMap[Number(k)] = v;
      }
      setAnnotations(annMap);
    } catch {
      // endpoints may not be available yet
    }
  }, [range]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Auto-select latest turn
  useEffect(() => {
    if (spans.length > 0 && selectedTurn === null) {
      setSelectedTurn(spans[spans.length - 1].turn_id);
    }
  }, [spans, selectedTurn]);

  const currentSpan = spans.find((s) => s.turn_id === selectedTurn);
  const currentEvents = traceEvents.filter((e) => e.turn === selectedTurn);
  const currentAnnotation = selectedTurn !== null ? annotations[selectedTurn] : undefined;

  const handleSaveAnnotation = async (turnId: number, ann: Partial<Annotation>) => {
    try {
      await annotationApi.save(turnId, ann);
      setAnnotations((prev) => ({ ...prev, [turnId]: { ...prev[turnId], ...ann, turn_id: turnId } as Annotation }));
    } catch {
      // silent
    }
  };

  const handleExport = async (format: "jsonl" | "json") => {
    try {
      if (format === "jsonl") {
        const res = await annotationApi.exportJsonl();
        if (!res.examples || res.examples.length === 0) {
          alert("No annotated turns to export. Mark turns as 'Annotated' first.");
          return;
        }
        const blob = new Blob(
          [res.examples.map((e) => JSON.stringify(e)).join("\n")],
          { type: "application/jsonl" },
        );
        downloadBlob(blob, "training_data.jsonl");
      } else {
        const res = await annotationApi.exportJson();
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
        downloadBlob(blob, "telemetry_dump.json");
      }
    } catch {
      // silent
    }
  };

  return (
    <div className="flex h-full">
      {/* Turn list sidebar */}
      <TurnList
        spans={spans}
        annotations={annotations}
        selectedTurn={selectedTurn}
        onSelect={setSelectedTurn}
        range={range}
        onRangeChange={setRange}
        rangeOptions={RANGE_OPTIONS}
        onExport={handleExport}
      />

      {/* Turn detail panel */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {currentSpan ? (
          <TurnDetail
            span={currentSpan}
            events={currentEvents}
            annotation={currentAnnotation}
            onSaveAnnotation={(ann) => handleSaveAnnotation(currentSpan.turn_id, ann)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {spans.length === 0
              ? "No telemetry data yet. Start a conversation to generate spans."
              : "Select a turn from the sidebar."}
          </div>
        )}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
