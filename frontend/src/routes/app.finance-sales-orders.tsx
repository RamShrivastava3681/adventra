import { createFileRoute } from "@tanstack/react-router";
import { SalesOrdersPage } from "./app.sales-orders";

export const Route = createFileRoute("/app/finance-sales-orders")({
  component: SalesOrdersPage,
});
