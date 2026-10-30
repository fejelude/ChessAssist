import { detectDocument } from "../recognition/dom";
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
  let debounce: ReturnType<typeof setTimeout> | undefined,
    pollTimer: ReturnType<typeof setInterval> | undefined;
  function send(detection: Detection) {
    const key = JSON.stringify([
      detection.fen,
      detection.placement,
      detection.bounds,
      detection.orientation,
      detection.turn,
      detection.castling,
      detection.ep,
      detection.playerColor,
      detection.issues,
    ]);
    if (key === lastSent && detection.placement) return;
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
    clearTimeout(debounce);
    debounce = setTimeout(() => scan(), 450);
  }
  function stop() {
    auto = false;
    poll = false;
    observer?.disconnect();
    observer = undefined;
    clearInterval(pollTimer);
    clearTimeout(debounce);
  }
  function watch() {
    observer?.disconnect();
    observer = undefined;
    if (!auto) return;
    observer = new MutationObserver(schedule);
    observer.observe(target || document.body, {
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
        "src",
        "href",
        "aria-label",
      ],
    });
  }
  function monitor(visualPolling: boolean) {
    auto = true;
    poll = visualPolling;
    lastPing = Date.now();
    watch();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (Date.now() - lastPing > 35000) {
        stop();
        return;
      }
      if (document.hidden || selecting) return;
      if (poll) scan();
      else if (target && !target.isConnected) {
        lastSent = "";
        scan();
      }
    }, 2500);
  }
  function selectRegion() {
    if (selecting) return;
    selecting = true;
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
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      }
    };
    document.addEventListener("keydown", escape, true);
    overlay.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      overlay.setPointerCapture(e.pointerId);
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
      requestAnimationFrame(() => requestAnimationFrame(() => scan()));
    });
  }
  // Observing genuine user input is useful for canvas/WebGL, which do not emit DOM mutations.
  for (const event of ["pointerup", "keyup", "touchend"])
    document.addEventListener(event, schedule, {
      passive: true,
      capture: true,
    });
  const geometryChanged = () => {
    if (manual) {
      manual = undefined;
      lastSent = "";
    }
    schedule();
  };
  window.addEventListener("resize", geometryChanged, { passive: true });
  window.addEventListener("scroll", geometryChanged, {
    passive: true,
    capture: true,
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "CA_HELLO") {
      respond({ ready: true });
      return;
    }
    if (message.type === "CA_SCAN") {
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
