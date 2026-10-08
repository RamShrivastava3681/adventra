import { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  INDIAN_STATES,
  getCitiesForState,
} from "@/lib/india-city-state";

/**
 * Reusable State → City dropdowns for any Indian address in the application
 * (Sales Orders, Purchase Orders, Customers, Suppliers, billing / shipping /
 * company addresses, …).
 *
 * - State is a searchable dropdown over the standardized INDIAN_STATES list.
 * - City is a dependent searchable dropdown: disabled until a State is
 *   selected, showing only that state's cities.
 * - Changing the State always clears the City (a city from one state can
 *   never remain selected after the state changes).
 * - Legacy free-text values stored on old records are appended as extra
 *   options so existing documents keep displaying correctly.
 */

export function StateSelect({
  value,
  onChange,
  disabled,
  placeholder = "Select state…",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const options = useMemo(() => {
    const opts = INDIAN_STATES.map((s) => ({ value: s, label: s }));
    // Legacy free-text state on an old record — keep it visible/selectable.
    if (value && !INDIAN_STATES.includes(value)) {
      opts.push({ value, label: `${value} (custom)` });
    }
    return opts;
  }, [value]);
  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      emptyText="No matching state"
      searchPlaceholder="Search states…"
      disabled={disabled}
    />
  );
}

export function CitySelect({
  stateValue,
  value,
  onChange,
  disabled,
  loading,
  placeholder,
}: {
  /** Currently selected (canonical or legacy) state. */
  stateValue: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** While city data is being fetched (API-backed use) — shows a loading row. */
  loading?: boolean;
  placeholder?: string;
}) {
  const cities = useMemo(() => getCitiesForState(stateValue), [stateValue]);
  const options = useMemo(() => {
    const opts = cities.map((c) => ({ value: c, label: c }));
    // Legacy free-text city on an old record — keep it visible/selectable.
    if (value && !cities.includes(value)) {
      opts.push({ value, label: `${value} (custom)` });
    }
    return opts;
  }, [cities, value]);

  const noState = !stateValue;
  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={loading ? [] : options}
      placeholder={placeholder ?? (noState ? "Select a state first…" : "Select city…")}
      emptyText={
        loading
          ? "Loading cities…"
          : noState
            ? "Select a state first"
            : cities.length === 0 && !value
              ? "No cities found for this state"
              : "No matching city"
      }
      searchPlaceholder="Search cities…"
      disabled={disabled || noState || loading}
    />
  );
}

export function StateCityFields({
  stateValue,
  cityValue,
  onStateChange,
  onCityChange,
  disabled,
  loading,
  statePlaceholder,
  cityPlaceholder,
}: {
  stateValue: string;
  cityValue: string;
  onStateChange: (value: string) => void;
  onCityChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
  statePlaceholder?: string;
  cityPlaceholder?: string;
}) {
  const handleStateChange = (next: string) => {
    if (next === stateValue) return;
    onStateChange(next);
    // Never allow a city from one state to remain after the state changes.
    if (cityValue) onCityChange("");
  };
  return (
    <>
      <StateSelect
        value={stateValue}
        onChange={handleStateChange}
        disabled={disabled}
        placeholder={statePlaceholder}
      />
      <CitySelect
        stateValue={stateValue}
        value={cityValue}
        onChange={onCityChange}
        disabled={disabled}
        loading={loading}
        placeholder={cityPlaceholder}
      />
    </>
  );
}
