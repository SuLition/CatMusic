import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAppSettings, openDebugWindow, openSettingsWindow } from "../ipc/commands";
import { listenToAudioFeatures, listenToSettingsChanged } from "../ipc/events";
import type { AppSettings, AudioFeatureFrame } from "../ipc/types";
import { createVisualizerAnimation, type VisualizerAnimation } from "./animation-registry";

export async function createVisualizerPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <main class="visualizer-shell">
      <section id="visualizer-surface" class="visualizer-surface" data-tauri-drag-region>
        <div id="visualizer-host" class="visualizer-host" aria-label="&#38899;&#39057;&#21487;&#35270;&#21270;"></div>
        <div id="visualizer-context-menu" class="visualizer-context-menu" role="menu" aria-hidden="true">
          <button type="button" class="visualizer-context-menu-item" role="menuitem" data-context-action="settings">&#25171;&#24320;&#35774;&#32622;</button>
          <button type="button" class="visualizer-context-menu-item" role="menuitem" data-context-action="debug">&#25171;&#24320;&#35843;&#35797;</button>
        </div>
      </section>
    </main>
  `;

  const surface = requireElement(root, "#visualizer-surface");
  const host = requireElement(root, "#visualizer-host");
  const contextMenu = requireElement(root, "#visualizer-context-menu");
  const contextMenuController = createVisualizerContextMenu(surface, contextMenu);

  let settings = await getAppSettings();
  let animation = mountAnimation(host, settings);
  let animationType = settings.animationType;

  surface.addEventListener("pointerdown", (event) => {
    if (contextMenu.contains(event.target as Node)) {
      return;
    }

    contextMenuController.hide();

    if (event.button !== 0) {
      return;
    }

    void getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  });

  await listenToAudioFeatures((frame) => {
    animation.render(frame);
  });

  await listenToSettingsChanged((nextSettings) => {
    settings = nextSettings;
    if (settings.animationType !== animationType) {
      animation.destroy();
      animation = mountAnimation(host, settings);
      animationType = settings.animationType;
      return;
    }

    animation.updateSettings(settings);
  });
}

type VisualizerContextAction = "settings" | "debug";

function createVisualizerContextMenu(
  surface: HTMLElement,
  contextMenu: HTMLElement,
): { hide(): void } {
  const hide = () => {
    contextMenu.classList.remove("is-open");
    contextMenu.setAttribute("aria-hidden", "true");
  };

  const show = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    contextMenu.style.left = "0px";
    contextMenu.style.top = "0px";
    contextMenu.classList.add("is-open");
    contextMenu.setAttribute("aria-hidden", "false");

    const bounds = contextMenu.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - bounds.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - bounds.height - margin);
    const left = Math.min(Math.max(event.clientX, margin), maxLeft);
    const top = Math.min(Math.max(event.clientY, margin), maxTop);

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
  };

  surface.addEventListener("contextmenu", show);

  contextMenu.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  contextMenu.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  contextMenu.addEventListener("click", (event) => {
    const action = (event.target as Element)
      .closest<HTMLButtonElement>("[data-context-action]")
      ?.dataset.contextAction as VisualizerContextAction | undefined;

    if (!action) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    hide();
    void runContextMenuAction(action);
  });

  window.addEventListener("blur", hide);
  window.addEventListener("resize", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hide();
    }
  });

  return { hide };
}

async function runContextMenuAction(action: VisualizerContextAction): Promise<void> {
  if (action === "settings") {
    await openSettingsWindow();
    return;
  }

  await openDebugWindow();
}

function mountAnimation(host: HTMLElement, settings: AppSettings): VisualizerAnimation {
  const animation = createVisualizerAnimation(settings.animationType);
  animation.mount(host);
  animation.updateSettings(settings);
  animation.render(silentFrame());
  return animation;
}

function silentFrame(): AudioFeatureFrame {
  return {
    schemaVersion: 3,
    seq: 0,
    timestampMs: 0,
    volume: 0,
    rhythm: false,
    spectrum: Array.from({ length: 32 }, () => 0),
    melody: null,
  };
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);

  if (!element) {
    throw new Error(`Missing visualizer element: ${selector}`);
  }

  return element;
}
