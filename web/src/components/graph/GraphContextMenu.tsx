import { useEffect, useRef } from "react";
import { Pencil, Trash2, Merge, Link } from "lucide-react";

interface GraphContextMenuProps {
  type: "node" | "edge";
  targetId: string;
  x: number;
  y: number;
  onClose: () => void;
  // Node actions
  onEditNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onMarkForMerge?: (nodeId: string) => void;
  // Edge actions
  onEditEdge?: (edgeId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
}

export function GraphContextMenu({
  type,
  targetId,
  x,
  y,
  onClose,
  onEditNode,
  onDeleteNode,
  onMarkForMerge,
  onEditEdge,
  onDeleteEdge,
}: GraphContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Boundary detection: flip if overflowing viewport
  const menuWidth = 180;
  const menuHeight = type === "node" ? 120 : 80;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjustedY = y + menuHeight > window.innerHeight ? y - menuHeight : y;

  const items =
    type === "node"
      ? [
          { label: "Edit node", icon: Pencil, onClick: () => { onEditNode?.(targetId); onClose(); } },
          { label: "Mark for merge", icon: Merge, onClick: () => { onMarkForMerge?.(targetId); onClose(); } },
          { label: "Delete node", icon: Trash2, onClick: () => { onDeleteNode?.(targetId); onClose(); }, destructive: true },
        ]
      : [
          { label: "Edit relation", icon: Link, onClick: () => { onEditEdge?.(targetId); onClose(); } },
          { label: "Delete edge", icon: Trash2, onClick: () => { onDeleteEdge?.(targetId); onClose(); }, destructive: true },
        ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[170px] rounded-lg border border-border bg-popover p-1 shadow-lg"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.onClick}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
            item.destructive
              ? "text-destructive hover:bg-destructive/10"
              : "text-foreground hover:bg-accent"
          }`}
        >
          <item.icon size={14} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
