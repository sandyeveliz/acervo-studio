import { useState, useCallback, useRef, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
}

export function usePrompt() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PromptOptions>({ title: "" });
  const [value, setValue] = useState("");
  const resolveRef = useRef<((value: string | null) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback((opts: PromptOptions): Promise<string | null> => {
    setOptions(opts);
    setValue("");
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const trimmed = value.trim();
    setOpen(false);
    resolveRef.current?.(trimmed || null);
    resolveRef.current = null;
  }, [value]);

  const handleCancel = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(null);
    resolveRef.current = null;
  }, []);

  useEffect(() => {
    if (open) {
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const PromptDialog = (
    <AlertDialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options.title}</AlertDialogTitle>
          {options.description && (
            <AlertDialogDescription>{options.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) handleConfirm();
            if (e.key === "Escape") handleCancel();
          }}
          placeholder={options.placeholder ?? ""}
          className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!value.trim()}>
            {options.confirmLabel ?? "Create"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { prompt, PromptDialog };
}
