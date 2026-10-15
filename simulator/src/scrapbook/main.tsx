import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./scrapbook.css";

// Toki's typeface for the canvas (it draws with whatever has loaded).
void document.fonts?.load('700 28px "Baloo 2"');
void document.fonts?.load('500 28px "Baloo 2"');
import { CardProvider } from "./CardLayer";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CardProvider>
      <App />
    </CardProvider>
  </StrictMode>,
);
