"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface SearchableOption {
  /** Stable id stored in the form ("" is treated as "nothing selected"). */
  value: string;
  /** Primary line shown in the trigger and list. */
  label: string;
  /** Secondary detail line (number, customer, status…) also searched. */
  hint?: string;
}

/**
 * SearchableSelect — a dropdown that also lets you type to filter.
 *
 * Keeps the familiar "pick from a list" behaviour while adding a search box,
 * so long catalogues (products, orders, parties…) are navigable by typing.
 * Used everywhere an entity/document is linked (invoices ↔ orders ↔ proformas
 * ↔ suppliers ↔ debtors ↔ products …).
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  emptyText = "No matching option",
  searchPlaceholder = "Type to search…",
  disabled,
  className,
  triggerClassName,
  side,
  align,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);

  // cmdk filters on the CommandItem `value` prop, so it must carry every
  // searchable fragment (label + hint + id) — not just the stored id.
  const searchKey = (o: SearchableOption) =>
    `${o.label} ${o.hint ?? ""} ${o.value}`.toLowerCase();
  const optionsByKey = React.useMemo(() => {
    const map = new Map<string, SearchableOption>();
    for (const o of options) map.set(searchKey(o), o);
    return map;
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between rounded-md border border-border bg-input px-3 py-2 text-sm font-normal text-foreground shadow-sm outline-none transition-all hover:bg-input hover:text-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground",
            className,
            triggerClassName,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align ?? "start"}
        className="w-[var(--radix-popover-trigger-width)] p-0 shadow-dropdown"
      >
        <Command>
          <CommandInput autoFocus placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={searchKey(o)}
                  onSelect={(key) => {
                    const opt = optionsByKey.get(key);
                    if (opt) onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{o.label}</span>
                    {o.hint && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {o.hint}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
