import "./styles/main.css";
import { createDebugPage } from "./debug/debug-page";
import { createSettingsPage } from "./settings/settings-page";
import { createVisualizerPage } from "./visualizer/visualizer-page";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Missing #app root element");
}

const view = new URLSearchParams(window.location.search).get("view");

if (view === "settings") {
  createSettingsPage(root);
} else if (view === "debug") {
  createDebugPage(root);
} else {
  createVisualizerPage(root);
}
