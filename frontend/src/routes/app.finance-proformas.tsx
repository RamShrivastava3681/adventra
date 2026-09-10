import { createFileRoute } from "@tanstack/react-router";
import { ProformasPage } from "./app.proformas";

export const Route = createFileRoute("/app/finance-proformas")({
  component: ProformasPage,
});
