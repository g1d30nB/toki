import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// Toki's typeface for the canvas (it draws with whatever has loaded).
void document.fonts?.load('700 28px "Baloo 2"');
void document.fonts?.load('500 28px "Baloo 2"');
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
