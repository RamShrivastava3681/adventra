import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputBase } from "@/components/dialog";

/**
 * ClauseCombobox — a text input with a saved-values dropdown, used for the
 * purchase-order clause fields (packaging, delivery terms, …).
 *
 * Type to filter previously saved texts, pick one to fill the field, or keep
 * typing something new — new texts are saved to the clause library
 * automatically when the PO is saved, so they appear in the dropdown next time.
 */
export function ClauseCombobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Previously saved texts for this clause kind. */
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const q = value.trim().toLowerCase();
  const filtered = options.filter((o) => !q || o.toLowerCase().includes(q));
  const isNew = value.trim() !== "" && !options.some((o) => o.toLowerCase() === q);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          className={cn(inputBase, "pr-14")}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        <div className="absolute inset-y-0 right-0 flex items-center">
          {value && !disabled && (
            <button
              type="button"
              title="Clear"
              onClick={() => onChange("")}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Saved texts"
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-dropdown">
          {filtered.length === 0 && !isNew && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No saved texts yet — type one above; it saves with the PO.
            </div>
          )}
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              <Check
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  value.trim().toLowerCase() === o.toLowerCase() ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{o}</span>
            </button>
          ))}
          {isNew && (
            <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              New text — will be saved to the library with this PO.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
