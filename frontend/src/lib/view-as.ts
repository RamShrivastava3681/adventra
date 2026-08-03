import { useRouterState } from "@tanstack/react-router";

/**
 * Returns the active view-as user id (reporting manager impersonation), if any.
 *
 * The reporting manager enters view-as mode by navigating to a page with a
 * `viewAsUserId` search param (e.g. `/app/workspace?viewAsUserId=<id>`). While
 * active, the api-client automatically forwards the param on every GET so all
 * data is scoped to the viewed employee.
 */
export function useViewAsUserId(): string | undefined {
  const search = useRouterState({
    select: (s) => s.location.search as Record<string, unknown>,
  });
  const v = search.viewAsUserId;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
