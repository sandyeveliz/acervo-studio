import { useEffect } from "react";

/**
 * Listens for "acervo:graph-updated" DOM events dispatched by useWebSocket
 * when conversation_indexed or graph_updated events arrive.
 * Calls onGraphUpdate to trigger a graph data reload.
 */
export function useGraphEvents(onGraphUpdate: () => void) {
  useEffect(() => {
    const handler = () => onGraphUpdate();
    window.addEventListener("acervo:graph-updated", handler);
    return () => window.removeEventListener("acervo:graph-updated", handler);
  }, [onGraphUpdate]);
}
