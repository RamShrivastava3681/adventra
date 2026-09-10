import { Route as PurchasesRoute } from "./app.purchases";

export const Route = PurchasesRoute.update({
  id: "/finance-purchases",
  path: "/finance-purchases",
} as any);
