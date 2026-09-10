import { createFileRoute } from "@tanstack/react-router";
import { InvoicesPage } from "./app.invoices";

export const Route = createFileRoute("/app/finance-invoices")({
  component: InvoicesPage,
});
