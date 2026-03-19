import { cn } from "@/lib/utils";

interface SettingsFieldProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  modified?: boolean;
}

export function SettingsField({ label, description, children, modified }: SettingsFieldProps) {
  return (
    <div className="flex items-start justify-between gap-8 py-3">
      <div className="flex-1 min-w-0">
        <label className={cn("text-sm font-medium", modified && "text-primary")}>
          {label}
          {modified && <span className="ml-1.5 text-[10px] text-primary">(modified)</span>}
        </label>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="w-64 flex-shrink-0">{children}</div>
    </div>
  );
}

interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TextField({ value, onChange, placeholder }: TextFieldProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-input bg-secondary/50 px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberField({ value, onChange, min, max, step = 1 }: NumberFieldProps) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="w-full rounded-md border border-input bg-secondary/50 px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

interface ToggleFieldProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function ToggleField({ value, onChange }: ToggleFieldProps) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer",
        value ? "bg-primary" : "bg-secondary",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-background transition-transform",
          value ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
