import * as React from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "whizunik-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage unavailable (private mode, blocked cookies) — fall through.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

type ThemeContextValue = {
  /** The user's stored preference — "light" | "dark" | "system". */
  theme: Theme;
  /** The theme actually applied to the document. */
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(getInitialTheme);
  const [systemDark, setSystemDark] = React.useState<boolean>(systemPrefersDark);

  // Follow OS preference changes while in (or defaulting to) system mode.
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // Keep the `.dark` class on <html> in sync with the resolved theme, and let
  // the browser render native widgets (scrollbars, inputs, dialogs) in the
  // matching colour scheme.
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  // Persist the preference only (system stays dynamic).
  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable — theme still applies for this session.
    }
  }, [theme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme: resolved,
      setTheme: setThemeState,
      toggleTheme: () => {
        // Quick toggle cycles light → dark → system (in that order) so the
        // header control stays useful next to the full preference menu.
        setThemeState((t) => (t === "light" ? "dark" : t === "dark" ? "system" : "light"));
      },
    }),
    [theme, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext);
}
