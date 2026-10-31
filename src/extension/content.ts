import { detectDocument, allElements } from "../recognition/dom";
import type { Bounds, Detection } from "../types";

(() => {
  const scope = globalThis as typeof globalThis & { __chessAssist?: boolean };
  if (scope.__chessAssist) return;
  scope.__chessAssist = true;
  let target: Element | undefined,
    manual: Bounds | undefined,
    observer: MutationObserver | undefined;
  let auto = false,
    poll = false,
    lastPing = 0,
    lastSent = "",
    selecting = false;
  let cancelSelection: (() => void) | undefined;
  let selectionGeneration = 0;
  let shadowRoots: ShadowRoot[] = [];
  let debounce: ReturnType<typeof setTimeout> | undefined,
    pollTimer: ReturnType<typeof setInterval> | undefined;
  function send(detection: Detection) {
    const key = JSON.stringify([
      detection.fen,
      detection.placement,
      detection.bounds,
      detection.viewport,
      detection.method,
      detection.orientation,
      detection.turn,
      detection.castling,
      detection.ep,
      detection.halfmove,
      detection.fullmove,
      detection.ambiguous,
      detection.confidence,
      detection.playerColor,
      detection.issues,
    ]);
    // Pixels can change without any DOM metadata (canvas/WebGL). Those scans
    // must still reach the screenshot worker, including on a polling heartbeat.
    if (
      key === lastSent &&
      (detection.fen || detection.placement || detection.ambiguous)
    )
      return;
    lastSent = key;
    void chrome.runtime
      .sendMessage({ type: "CA_DETECTION", detection })
      .catch(stop);
  }
  function scan(emit = true): Detection {
    const found = detectDocument(manual);
    target = found.target;
    const detection =
      found.detection ||
      ({
        method: "visual",
        confidence: 0,
        issues: ["No readable DOM board found. Trying visual recognition."],
        bounds: manual,
        viewport: { width: innerWidth, height: innerHeight },
        url: location.origin,
        timestamp: Date.now(),
      } as Detection);
    if (manual && !found.detection?.placement && !found.detection?.fen)
      detection.bounds = manual;
    if (emit) send(detection);
    watch();
    return detection;
  }
  function schedule() {
    if (!auto || document.hidden || selecting) return;
    // Keep the first deadline: continuous page mutations must not starve scans.
    if (debounce !== undefined) return;
    debounce = setTimeout(() => {
      debounce = undefined;
      if (auto && !document.hidden && !selecting) scan();
    }, 450);
  }
  function stop() {
    auto = false;
    poll = false;
    ++selectionGeneration;
    cancelSelection?.();
    setInputListeners(false);
    observer?.disconnect();
    observer = undefined;
    clearInterval(pollTimer);
    clearTimeout(debounce);
    debounce = undefined;
    lastSent = "";
    shadowRoots = [];
  }
  function currentShadows() {
    if (!target) return [];
    return [target, ...allElements(target)]
      .map((el) => el.shadowRoot)
      .filter((root): root is ShadowRoot => Boolean(root));
  }
  function watch() {
    observer?.disconnect();
    observer = undefined;
    if (!auto) return;
    observer = new MutationObserver(schedule);
    const options: MutationObserverInit = {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: [
        "class",
        "style",
        "data-fen",
        "fen",
        "data-piece",
        "data-square",
        "data-turn",
        "data-side-to-move",
        "data-orientation",
        "data-castling",
        "data-en-passant",
        "data-halfmove",
        "data-fullmove",
        "data-player-color",
        "orientation",
        "alt",
        "title",
        "src",
        "href",
        "aria-label",
      ],
    };
    observer.observe(target || document.documentElement, options);
    shadowRoots = currentShadows();
    for (const root of shadowRoots) observer.observe(root, options);
    // Attribute changes on a board's host/ancestors can change its orientation
    // or visibility. Child-list changes also catch board replacement/removal.
    let ancestor: Node | null = target || null;
    while (ancestor) {
      ancestor =
        ancestor.parentNode ||
        (ancestor instanceof ShadowRoot ? ancestor.host : null);
      if (ancestor)
        observer.observe(ancestor, {
          childList: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden"],
        });
    }
  }
  function monitor(visualPolling: boolean) {
    poll = visualPolling;
    lastPing = Date.now();
    if (auto) return;
    auto = true;
    setInputListeners(true);
    watch();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (Date.now() - lastPing > 35000) {
        stop();
        return;
      }
      if (document.hidden || selecting) return;
      if (poll) scan();
      else if (
        !target ||
        !target.isConnected ||
        currentShadows().some((root) => !shadowRoots.includes(root))
      ) {
        lastSent = "";
        scan();
      }
    }, 2500);
  }
  function selectRegion() {
    if (selecting) return;
    selecting = true;
    clearTimeout(debounce);
    debounce = undefined;
    const generation = ++selectionGeneration;
    const overlay = document.createElement("div");
    overlay.id = "chess-assist-region-selector";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(0,0,0,.35)",
      cursor: "crosshair",
      touchAction: "none",
    });
    const help = document.createElement("div");
    help.textContent =
      "Chess Assist · Drag a square around the board’s inner 8 × 8 area. Esc to cancel.";
    Object.assign(help.style, {
      position: "absolute",
      top: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "14px 20px",
      borderRadius: "12px",
      background: "#131a17",
      color: "#eaf3ed",
      font: "14px system-ui",
      pointerEvents: "none",
    });
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "absolute",
      border: "2px solid #b5d395",
      background: "rgba(181,211,149,.15)",
      pointerEvents: "none",
    });
    overlay.append(help, box);
    document.documentElement.append(overlay);
    let start: { x: number; y: number } | undefined, region: Bounds | undefined;
    const cleanup = () => {
      overlay.remove();
      document.removeEventListener("keydown", escape, true);
      selecting = false;
      cancelSelection = undefined;
    };
    cancelSelection = cleanup;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        void chrome.runtime
          .sendMessage({ type: "CA_SELECTION_CANCELLED" })
          .catch(stop);
      }
    };
    document.addEventListener("keydown", escape, true);
    overlay.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      overlay.setPointerCapture(e.pointerId);
      region = undefined;
      start = { x: e.clientX, y: e.clientY };
    });
    overlay.addEventListener("pointermove", (e) => {
      if (!start) return;
      e.preventDefault();
      e.stopPropagation();
      const size = Math.min(
        Math.abs(e.clientX - start.x),
        Math.abs(e.clientY - start.y),
      );
      region = {
        x: e.clientX < start.x ? start.x - size : start.x,
        y: e.clientY < start.y ? start.y - size : start.y,
        width: size,
        height: size,
      };
      Object.assign(box.style, {
        left: `${region.x}px`,
        top: `${region.y}px`,
        width: `${size}px`,
        height: `${size}px`,
      });
    });
    overlay.addEventListener("pointerup", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chosen = region;
      cleanup();
      if (!chosen || chosen.width < 100) return;
      manual = chosen;
      lastSent = "";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (generation === selectionGeneration) scan();
        }),
      );
    });
  }
  // Keep page input listeners only while a panel is monitoring this source.
  const inputEvents = ["pointerup", "keyup", "touchend"];
  const geometryChanged = () => {
    if (manual) {
      manual = undefined;
      lastSent = "";
    }
    schedule();
  };
  const visibleAgain = () => {
    if (!document.hidden) schedule();
  };
  function setInputListeners(enabled: boolean) {
    for (const event of inputEvents) {
      if (enabled)
        document.addEventListener(event, schedule, {
          passive: true,
          capture: true,
        });
      else document.removeEventListener(event, schedule, true);
    }
    if (enabled) {
      window.addEventListener("resize", geometryChanged, { passive: true });
      window.addEventListener("scroll", geometryChanged, {
        passive: true,
        capture: true,
      });
      document.addEventListener("visibilitychange", visibleAgain);
      window.addEventListener("pagehide", stop);
    } else {
      window.removeEventListener("resize", geometryChanged);
      window.removeEventListener("scroll", geometryChanged, true);
      document.removeEventListener("visibilitychange", visibleAgain);
      window.removeEventListener("pagehide", stop);
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "CA_HELLO") {
      respond({ ready: true });
      return;
    }
    if (message.type === "CA_SCAN") {
      manual = undefined;
      lastSent = "";
      respond({ detection: scan(false) });
      return;
    }
    if (message.type === "CA_SELECT") {
      selectRegion();
      respond({ selecting: true });
      return;
    }
    if (message.type === "CA_MONITOR") {
      monitor(Boolean(message.visualPolling));
      respond({ monitoring: true });
      return;
    }
    if (message.type === "CA_STOP") {
      stop();
      respond({ stopped: true });
      return;
    }
  });
})();
