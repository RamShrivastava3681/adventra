import { createFileRoute } from "@tanstack/react-router";
import { PurchasesPage } from "./app.purchases";

export const Route = createFileRoute("/app/finance-purchases")({
  component: PurchasesPage,
});
