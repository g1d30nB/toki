import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./scrapbook.css";

import { CardProvider } from "./CardLayer";
import { App } from "./App";

// Toki's typeface for the canvas, which draws with whatever has loaded: the lettered
// stickers are drawn once and kept, so wait for it (a local file: milliseconds).
const fonts = ["800 100px", "700 28px", "500 28px"].map((f) => document.fonts?.load(`${f} "Baloo 2"`));
void Promise.allSettled(fonts).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <CardProvider>
        <App />
      </CardProvider>
    </StrictMode>,
  ),
);
