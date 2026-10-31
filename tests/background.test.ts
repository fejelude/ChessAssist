import { beforeEach, afterEach, expect, it, vi } from "vitest";
let receive: any;
let connect: any;
let api: any;
beforeEach(async () => {
  vi.resetModules();
  api = {
    action: { onClicked: { addListener: vi.fn() } },
    sidePanel: { open: vi.fn().mockResolvedValue(undefined) },
    runtime: {
      onConnect: {
        addListener: (fn: any) => {
          connect = fn;
        },
      },
      onMessage: {
        addListener: (fn: any) => {
          receive = fn;
        },
      },
    },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    tabs: {
      get: vi
        .fn()
        .mockResolvedValue({
          id: 1,
          windowId: 10,
          url: "https://practice.test/board",
        }),
      query: vi
        .fn()
        .mockResolvedValue([
          { id: 1, url: "https://practice.test/board", status: "complete" },
        ]),
      sendMessage: vi.fn().mockResolvedValue({ ready: true }),
      captureVisibleTab: vi
        .fn()
        .mockResolvedValue("data:image/png;base64,local"),
    },
  };
  vi.stubGlobal("chrome", api);
  await import("../src/extension/background");
});
afterEach(() => vi.unstubAllGlobals());
async function request(type: string) {
  const respond = vi.fn();
  expect(receive({ type, tabId: 1 }, {}, respond)).toBe(true);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
  return respond.mock.calls[0][0];
}
it("ignores malformed and content-originated privileged requests", () => {
  expect(receive(null, {}, vi.fn())).toBeUndefined();
  expect(
    receive({ type: "CA_CAPTURE", tabId: 1 }, { tab: { id: 1 } }, vi.fn()),
  ).toBeUndefined();
  expect(api.tabs.get).not.toHaveBeenCalled();
});
it("returns a local capture only while the same page remains active", async () => {
  expect(await request("CA_CAPTURE")).toEqual({
    ok: true,
    url: "data:image/png;base64,local",
  });
  api.tabs.query
    .mockResolvedValueOnce([{ id: 1 }])
    .mockResolvedValueOnce([{ id: 2 }]);
  expect((await request("CA_CAPTURE")).ok).toBe(false);
  api.tabs.query
    .mockResolvedValueOnce([{ id: 1 }])
    .mockResolvedValueOnce([
      { id: 1, url: "https://different.test", status: "complete" },
    ]);
  expect((await request("CA_CAPTURE")).ok).toBe(false);
});
it("reports protected-page and injection failures through the response", async () => {
  api.tabs.get.mockResolvedValueOnce({
    id: 1,
    url: "chrome://extensions",
    windowId: 10,
  });
  expect((await request("CA_SCAN")).error).toContain("protects");
  api.tabs.sendMessage.mockRejectedValueOnce(new Error("no receiver"));
  api.scripting.executeScript.mockRejectedValueOnce(new Error("access denied"));
  expect((await request("CA_SCAN")).error).toContain("toolbar");
});
it("keeps monitoring until the last panel bound to the tab disconnects", () => {
  function panel() {
    let message: any, disconnect: any;
    const port = {
      name: "chess-assist-panel",
      onMessage: {
        addListener: (fn: any) => {
          message = fn;
        },
      },
      onDisconnect: {
        addListener: (fn: any) => {
          disconnect = fn;
        },
      },
    };
    connect(port);
    message({ type: "BIND", tabId: 1 });
    return () => disconnect();
  }
  const first = panel(),
    second = panel();
  first();
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
  second();
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(1, { type: "CA_STOP" });
});
