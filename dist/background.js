// src/extension/background.ts
async function inject(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "CA_HELLO" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  }
}
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
  });
  void inject(tab.id).catch(() => {
  });
});
var bindings = /* @__PURE__ */ new Map();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "chess-assist-panel") return;
  let tabId;
  const release = () => {
    if (tabId === void 0) return;
    const ports = bindings.get(tabId);
    ports?.delete(port);
    if (ports && !ports.size) {
      bindings.delete(tabId);
      void chrome.tabs.sendMessage(tabId, { type: "CA_STOP" }).catch(() => {
      });
    }
    tabId = void 0;
  };
  port.onMessage.addListener((m) => {
    if (m?.type !== "BIND" || !Number.isInteger(m.tabId) || m.tabId === tabId)
      return;
    release();
    tabId = m.tabId;
    const ports = bindings.get(m.tabId) || /* @__PURE__ */ new Set();
    ports.add(port);
    bindings.set(m.tabId, ports);
  });
  port.onDisconnect.addListener(release);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message !== "object" || sender.tab || !["CA_SCAN", "CA_SELECT", "CA_CAPTURE", "CA_MONITOR", "CA_STOP"].includes(
    message.type
  ))
    return;
  void (async () => {
    try {
      const tabId = message.tabId;
      if (!Number.isInteger(tabId))
        throw new Error("Select a Chrome tab first.");
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || !/^(https?:|file:)/.test(tab.url) || /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(
        tab.url
      ))
        throw new Error(
          "Chrome protects this page. Open a normal webpage, or use FEN / PGN in Chess Assist."
        );
      if (message.type === "CA_CAPTURE") {
        const [active] = await chrome.tabs.query({
          active: true,
          windowId: tab.windowId
        });
        if (active?.id !== tabId)
          throw new Error(
            "Keep the source tab active while capturing its board."
          );
        const url = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png"
        });
        const [current] = await chrome.tabs.query({
          active: true,
          windowId: tab.windowId
        });
        if (current?.id !== tabId || current.url !== tab.url || current.status === "loading")
          throw new Error(
            "The active tab changed. Refresh the source position."
          );
        respond({ ok: true, url });
        return;
      }
      await inject(tabId);
      const result = await chrome.tabs.sendMessage(tabId, { ...message });
      respond({ ok: true, ...result });
    } catch (e) {
      respond({
        ok: false,
        error: `${e.message} If access was not granted, click the extension toolbar icon on this tab.`
      });
    }
  })();
  return true;
});
//# sourceMappingURL=background.js.map
