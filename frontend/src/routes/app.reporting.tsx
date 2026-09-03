import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app/reporting")({
  component: ReportingLayout,
});

/**
 * Layout route for the Reports module. Renders the matched child — the
 * Reports Dashboard (index) or a single report page ($report) — inside the
 * shared app shell. Without this <Outlet /> the $report child could never
 * display and clicking a report card appeared to do nothing.
 */
function ReportingLayout() {
  return <Outlet />;
}
