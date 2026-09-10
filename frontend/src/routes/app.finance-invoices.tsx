import { Route as InvoicesRoute } from "./app.invoices";

export const Route = InvoicesRoute.update({
  id: "/finance-invoices",
  path: "/finance-invoices",
} as any);
