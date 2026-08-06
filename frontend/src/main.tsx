import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";

const router = getRouter();

// Prevent the mouse wheel from changing number input values anywhere in the
// app. Scrolling over a number box simply blurs it (so the page still scrolls
// normally) — typing is the only way to edit these fields.
window.addEventListener(
  "wheel",
  (e) => {
    const target = e.target;
    if (target instanceof HTMLInputElement && target.type === "number") {
      target.blur();
    }
  },
  { passive: true },
);

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
