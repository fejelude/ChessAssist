// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
  configure,
} from "@testing-library/react";
import { Chess } from "chess.js";
import { START_FEN } from "../src/chess/position";
import type { Settings } from "../src/types";
const harness = { engines: [] as any[], sources: [] as any[] };
vi.doMock("../src/extension/bridge", () => ({
  isExtension: false,
  SourceBridge: class {
    lastFen = START_FEN;
    lastDetection = {
      fen: START_FEN,
      placement: START_FEN.split(" ")[0],
      orientation: "w",
      turn: "w",
      castling: "KQkq",
      ep: "-",
      method: "fen",
      viewport: { width: 100, height: 100 },
    };
    onPosition = (_f: string, _d: any) => {};
    onInvalidate = () => {};
    onProblem = (_p: any) => {};
    onStatus = (_s: string) => {};
    constructor() {
      harness.sources.push(this);
    }
    start() {
      this.onPosition(this.lastFen, this.lastDetection);
    }
    stop() {}
    dispose() {}
    select() {}
    confirm(fen: string) {
      this.lastFen = fen;
    }
  },
}));
vi.doMock("../src/engine/uci", () => {
  return {
    Engine: class {
      onStatus = (_s: string) => {};
      onResult = (_r: any) => {};
      onError = (_s: string) => {};
      calls: string[] = [];
      settings: Settings[] = [];
      resets = 0;
      constructor() {
        harness.engines.push(this);
      }
      async analyze(fen: string, settings: Settings) {
        this.calls.push(fen);
        this.settings.push(settings);
        this.respond(fen);
        return this.calls.length;
      }
      respond(fen: string) {
        const c = new Chess(fen),
          m = c.moves({ verbose: true })[0];
        if (m)
          this.onResult({
            id: 1,
            fen,
            finished: true,
            lines: [
              {
                rank: 1,
                depth: 12,
                cp: 20,
                pv: [m.from + m.to + (m.promotion || "")],
                nodes: 100,
                time: 30,
                nps: 1000,
              },
            ],
          });
      }
      cancel() {}
      reset() {
        this.resets++;
      }
      dispose() {}
    },
  };
});
const { default: App } = await import("../src/App");
configure({
  getElementError: (message) => new Error(message || "UI assertion failed"),
});
beforeEach(() => {
  localStorage.clear();
  harness.engines.length = 0;
  harness.sources.length = 0;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
});
afterEach(cleanup);
const engine = () => harness.engines.at(-1),
  source = () => harness.sources.at(-1);
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const move = (from: string, to: string) => {
  fireEvent.click(
    screen.getByRole("gridcell", { name: new RegExp(`^${from} `) }),
  );
  fireEvent.click(
    screen.getByRole("gridcell", { name: new RegExp(`^${to} `) }),
  );
};
async function open() {
  render(<App />);
  await waitFor(() => expect(engine().calls.length).toBeGreaterThan(0));
}
describe("minimal automatic workspace", () => {
  it("preserves results on duplicate source observations", async () => {
    await open();
    const before = engine().calls.length;
    act(() => source().onPosition(START_FEN, source().lastDetection));
    expect(document.querySelector(".move-arrow")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 230));
    expect(engine().calls.length).toBe(before);
  });
  it("auto-analyzes an open panel even if document.hidden is true, with no Analyze or consent checkbox", async () => {
    await open();
    expect(document.querySelector(".simple-move")?.textContent).toMatch(
      /[a-h][1-8]/,
    );
    expect(screen.queryByRole("button", { name: "Analyze" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.querySelector(".move-arrow")).not.toBeNull();
  });
  it("waits for White, then recommends a legal Black response after an opponent move", async () => {
    await open();
    const before = engine().calls.length;
    click("Black");
    expect(document.querySelector(".simple-move")?.textContent).toBe("Waiting");
    expect(document.querySelector(".move-arrow")).toBeNull();
    move("e2", "e4");
    await waitFor(() => expect(engine().calls.length).toBeGreaterThan(before));
    expect(engine().calls.at(-1).split(" ")[1]).toBe("b");
    expect(document.querySelector(".move-arrow")).not.toBeNull();
    expect(
      screen.getAllByRole("gridcell")[0].getAttribute("aria-label"),
    ).toMatch(/^h1/);
  });
  it("accepts independent moves and clears stale recommendations until the opponent moves", async () => {
    await open();
    const old = START_FEN;
    move("d2", "d4");
    expect(document.querySelector(".simple-move")?.textContent).toBe("Waiting");
    act(() => engine().respond(old));
    expect(document.querySelector(".move-arrow")).toBeNull();
    move("d7", "d5");
    await waitFor(() => expect(engine().calls.at(-1)).toContain("3p4/3P4"));
    expect(document.querySelector(".move-arrow")).not.toBeNull();
  });
  it("automatically responds to source positions and ignores obsolete engine results", async () => {
    await open();
    click("Select Board on Webpage");
    const c = new Chess();
    c.move("e4");
    act(() => {
      source().onInvalidate();
      source().onPosition(c.fen(), source().lastDetection);
    });
    expect(document.querySelector(".move-arrow")).toBeNull();
    c.move("e5");
    act(() => source().onPosition(c.fen(), source().lastDetection));
    await waitFor(() => expect(engine().calls.at(-1)).toBe(c.fen()));
    const arrow = document
      .querySelector(".move-arrow")
      ?.getAttribute("aria-label");
    act(() =>
      engine().onResult({
        id: 99,
        fen: START_FEN,
        finished: true,
        lines: [{ rank: 1, cp: 999, pv: ["h2h4"] }],
      }),
    );
    expect(
      document.querySelector(".move-arrow")?.getAttribute("aria-label"),
    ).toBe(arrow);
  });
  it("pauses and restarts, with an explicit Retry after an engine error", async () => {
    await open();
    click("Pause");
    expect(document.querySelector(".move-arrow")).toBeNull();
    click("Start");
    await waitFor(() =>
      expect(document.querySelector(".move-arrow")).not.toBeNull(),
    );
    act(() =>
      engine().onError("Could not analyze this position. Choose Retry."),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    const resets = engine().resets;
    click("Retry");
    await waitFor(() => expect(engine().resets).toBeGreaterThan(resets));
    await waitFor(() =>
      expect(document.querySelector(".move-arrow")).not.toBeNull(),
    );
  });
  it("corrects a piece without a repetitive approval form and resumes analysis", async () => {
    await open();
    click("Open menu");
    click("Correct Position");
    click("Erase piece");
    fireEvent.click(
      screen
        .getByRole("region", { name: "Edit position" })
        .querySelector('[aria-label="a2 white pawn"]')!,
    );
    click("Save and continue");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("gridcell", { name: "a2 empty" })).toBeDefined();
    await waitFor(() => expect(engine().calls.at(-1)).toContain("1PPPPPPP"));
  });
  it("recognition errors leave a working manual board with understandable feedback", async () => {
    await open();
    click("Select Board on Webpage");
    act(() => {
      source().onInvalidate();
      source().onProblem({
        message: "Some pieces are unclear. Choose Correct Position.",
      });
    });
    expect(
      screen.getByRole("button", { name: "Correct Position" }),
    ).toBeDefined();
    expect(document.querySelector(".simple-status")?.textContent).toContain(
      "Board not detected. You can enter the position manually.",
    );
    move("d2", "d4");
    move("d7", "d5");
    await waitFor(() => expect(engine().calls.at(-1)).toContain("3p4/3P4"));
    expect(document.querySelector(".move-arrow")).not.toBeNull();
  });
  it("handles repeated legal moves and terminal positions without stale arrows", async () => {
    await open();
    for (const [from, to] of [
      ["e2", "e4"],
      ["e7", "e5"],
      ["g1", "f3"],
      ["b8", "c6"],
      ["f1", "c4"],
      ["g8", "f6"],
    ])
      move(from, to);
    await waitFor(() => expect(engine().calls.at(-1)).toContain("2n2n2"));
    const c = new Chess();
    for (const m of ["f3", "e5", "g4", "Qh4#"]) c.move(m);
    click("Open menu");
    click("Reconnect to webpage");
    act(() => source().onPosition(c.fen(), source().lastDetection));
    await waitFor(() =>
      expect(document.querySelector(".simple-move")?.textContent).toBe(
        "Game over",
      ),
    );
    expect(document.querySelector(".move-arrow")).toBeNull();
  });
});

describe("manual fallback and unrestricted editing", () => {
  it("moves Black in Play mode while playing as White and supports Undo", async () => {
    await open();
    move("e2", "e4");
    move("e7", "e5");
    await waitFor(() => expect(engine().calls.at(-1)).toContain("4p3/4P3"));
    click("Undo");
    expect(
      screen.getByRole("gridcell", { name: "e7 black pawn" }),
    ).toBeDefined();
    expect(document.querySelector(".manual-history")?.textContent).toContain(
      "Black to move",
    );
  });
  it("edits either color out of turn using clicks and drag/drop without changing playing color", async () => {
    await open();
    click("Edit");
    move("e7", "e4");
    expect(
      screen.getByRole("gridcell", { name: "e4 black pawn" }),
    ).toBeDefined();
    move("b1", "h5");
    expect(
      screen.getByRole("gridcell", { name: "h5 white knight" }),
    ).toBeDefined();
    const transfer = {
      value: "",
      effectAllowed: "",
      setData(_t: string, v: string) {
        this.value = v;
      },
      getData() {
        return this.value;
      },
    };
    const piece = screen
      .getByRole("gridcell", { name: "g8 black knight" })
      .querySelector("img")!;
    fireEvent.dragStart(piece, { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("gridcell", { name: "a4 empty" }), {
      dataTransfer: transfer,
    });
    expect(
      screen.getByRole("gridcell", { name: "a4 black knight" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "White" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.querySelector(".move-arrow")).toBeNull();
  });
  it("clears/sets up a position, validates it, resets history, and automatically resumes real position requests", async () => {
    await open();
    move("e2", "e4");
    move("e7", "e5");
    click("Edit");
    click("Clear board");
    click("Save and continue");
    expect(screen.getByRole("alert").textContent).toMatch(/king/i);
    click("Add white king");
    fireEvent.click(screen.getByRole("gridcell", { name: "e1 empty" }));
    click("Add black king");
    fireEvent.click(screen.getByRole("gridcell", { name: "e8 empty" }));
    click("Add white rook");
    fireEvent.click(screen.getByRole("gridcell", { name: "a1 empty" }));
    click("Save and continue");
    await waitFor(() =>
      expect(engine().calls.at(-1)).toBe("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"),
    );
    expect(
      screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
    ).toBe(true);
  });
  it("manual moves and saved corrections cannot be overwritten by late source messages", async () => {
    await open();
    click("Select Board on Webpage");
    click("Edit");
    move("a2", "a3");
    act(() => source().onPosition(START_FEN, source().lastDetection));
    expect(
      screen.getByRole("gridcell", { name: "a3 white pawn" }),
    ).toBeDefined();
    click("Save and continue");
    act(() => source().onInvalidate());
    act(() => source().onPosition(START_FEN, source().lastDetection));
    expect(
      screen.getByRole("gridcell", { name: "a3 white pawn" }),
    ).toBeDefined();
    await waitFor(() => expect(engine().calls.at(-1)).toContain("P7/1PPPPPPP"));
  });
  it("does not silently assume unknown castling or en passant", async () => {
    await open();
    click("Select Board on Webpage");
    act(() =>
      source().onProblem({
        message: "needs correction",
        detection: {
          ...source().lastDetection,
          fen: undefined,
          castling: undefined,
          ep: undefined,
        },
      }),
    );
    click("Edit");
    click("Save and continue");
    expect(screen.getByRole("alert").textContent).toContain(
      "Choose castling rights",
    );
    click("No castling rights");
    click("No en passant");
    click("Save and continue");
    await waitFor(() =>
      expect(engine().calls.at(-1)).toBe(START_FEN.replace("KQkq", "-")),
    );
  });
  it("uses the Play tab to commit valid edits, and Reset restores a fresh playable board", async () => {
    await open();
    click("Edit");
    move("a2", "a3");
    click("Play");
    await waitFor(() => expect(engine().calls.at(-1)).toContain("P7/1PPPPPPP"));
    click("Reset");
    expect(
      screen.getByRole("gridcell", { name: "a2 white pawn" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("position-analysis consistency", () => {
  it("sends every legal Play position to the engine while keeping opponent-turn arrows hidden", async () => {
    await open();
    move("e2", "e4");
    const c = new Chess();
    c.move("e4");
    await waitFor(() => expect(engine().calls.at(-1)).toBe(c.fen()));
    expect(document.querySelector(".move-arrow")).toBeNull();
    move("e7", "e5");
    c.move("e5");
    await waitFor(() => expect(engine().calls.at(-1)).toBe(c.fen()));
    expect(document.querySelector(".move-arrow")).not.toBeNull();
  });
  it("keeps edited squares intact when orientation changes", async () => {
    await open();
    click("Edit");
    move("a2", "a3");
    fireEvent.change(screen.getByLabelText("Board orientation"), {
      target: { value: "b" },
    });
    expect(
      screen.getByRole("gridcell", { name: "a3 white pawn" }),
    ).toBeDefined();
    expect(
      screen.getAllByRole("gridcell")[0].getAttribute("aria-label"),
    ).toMatch(/^h1/);
    click("Save and continue");
    await waitFor(() => expect(engine().calls.at(-1)).toContain("P7/1PPPPPPP"));
  });
});

it("enters castling, en passant and underpromotion through the same manual Play board", async () => {
  await open();
  function load(fen: string) {
    click("Open menu");
    fireEvent.click(screen.getByText("Load a saved position"));
    fireEvent.change(screen.getByLabelText("Saved FEN"), {
      target: { value: fen },
    });
    click("Load position");
  }
  load("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  move("e1", "g1");
  expect(screen.getByRole("gridcell", { name: "g1 white king" })).toBeDefined();
  expect(screen.getByRole("gridcell", { name: "f1 white rook" })).toBeDefined();
  click("Undo");
  expect(screen.getByRole("gridcell", { name: "e1 white king" })).toBeDefined();
  load("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  move("e5", "d6");
  expect(screen.getByRole("gridcell", { name: "d6 white pawn" })).toBeDefined();
  expect(screen.getByRole("gridcell", { name: "d5 empty" })).toBeDefined();
  click("Undo");
  expect(screen.getByRole("gridcell", { name: "d5 black pawn" })).toBeDefined();
  load("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  move("a7", "a8");
  click("Knight");
  expect(
    screen.getByRole("gridcell", { name: "a8 white knight" }),
  ).toBeDefined();
  expect(document.querySelector(".move-arrow")).toBeNull();
});

it("recovers from malformed saved settings and still starts manual analysis", async () => {
  localStorage.setItem("simpleSettings", "{bad json");
  await open();
  expect(document.querySelector(".move-arrow")).not.toBeNull();
});
it("rejects unsupported stored thinking time and polling values", async () => {
  localStorage.setItem(
    "simpleSettings",
    JSON.stringify({ budget: "garbage", polling: "false" }),
  );
  await open();
  click("Open menu");
  expect(
    (screen.getByLabelText("Thinking time") as HTMLSelectElement).value,
  ).toBe("1800");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
});
it("returns to a usable committed board when cancelling Edit during connection", async () => {
  await open();
  source().start = () => {}; // The source has not answered yet.
  click("Select Board on Webpage");
  expect(document.querySelector(".move-arrow")).toBeNull();
  click("Edit");
  click("Cancel edits");
  await waitFor(() =>
    expect(document.querySelector(".move-arrow")).not.toBeNull(),
  );
  expect(screen.getByText(/Manual board ·/)).toBeDefined();
});

it("initializes correction metadata from a complete FEN without separate hints", async () => {
  const { PositionEditor } = await import("../src/ui/PositionEditor");
  const confirm = vi.fn();
  const fen = "4k3/8/8/8/8/8/8/4K2R b - - 0 1";
  render(
    <PositionEditor
      detection={{
        fen,
        method: "fen",
        confidence: 1,
        issues: [],
        viewport: { width: 800, height: 800 },
        url: "",
        timestamp: 1,
      }}
      onConfirm={confirm}
      onClose={() => {}}
    />,
  );
  click("Save and continue");
  expect(confirm).toHaveBeenCalledWith(fen, "w", []);
});

describe("Legit settings integration", () => {
  it("retains the complete FEN while changing levels and stays paused until resumed", async () => {
    await open();
    const fen = "r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 7 23";
    click("Open menu");
    fireEvent.click(screen.getByText("Load a saved position"));
    fireEvent.change(screen.getByLabelText("Saved FEN"), {
      target: { value: fen },
    });
    click("Load position");
    await waitFor(() => expect(engine().calls.at(-1)).toBe(fen));
    click("Pause");
    const calls = engine().calls.length;
    click("Open menu");
    fireEvent.change(screen.getByLabelText("Configuration"), {
      target: { value: "legit" },
    });
    fireEvent.change(screen.getByLabelText("Playing Strength"), {
      target: { value: "gm" },
    });
    click("Close menu");
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    await new Promise((r) => setTimeout(r, 230));
    expect(engine().calls.length).toBe(calls);
    click("Start");
    await waitFor(() => expect(engine().calls.length).toBeGreaterThan(calls));
    expect(engine().calls.at(-1)).toBe(fen);
    expect(engine().settings.at(-1).playingStrength).toBe("gm");
  });
  it("switches configurations and presets without losing moves, special rights, history or thinking time", async () => {
    await open();
    move("e2", "e4");
    move("a7", "a6");
    await waitFor(() => expect(engine().calls.at(-1)).not.toBe(START_FEN));
    const fen = engine().calls.at(-1),
      resets = engine().resets;
    click("Open menu");
    expect(screen.queryByLabelText("Playing Strength")).toBeNull();
    fireEvent.change(screen.getByLabelText("Thinking time"), {
      target: { value: "5000" },
    });
    fireEvent.change(screen.getByLabelText("Configuration"), {
      target: { value: "legit" },
    });
    expect(
      (screen.getByLabelText("Playing Strength") as HTMLSelectElement).value,
    ).toBe("default");
    fireEvent.change(screen.getByLabelText("Playing Strength"), {
      target: { value: "im" },
    });
    await waitFor(() =>
      expect(engine().settings.at(-1)).toMatchObject({
        configuration: "legit",
        playingStrength: "im",
        time: 5000,
      }),
    );
    expect(engine().calls.at(-1)).toBe(fen);
    fireEvent.change(screen.getByLabelText("Configuration"), {
      target: { value: "stockfish" },
    });
    await waitFor(() =>
      expect(engine().settings.at(-1).configuration).toBe("stockfish"),
    );
    expect(engine().calls.at(-1)).toBe(fen);
    expect(engine().resets).toBe(resets);
    click("Close menu");
    click("Undo");
    expect(
      screen.getByRole("gridcell", { name: "a7 black pawn" }),
    ).toBeDefined();
    expect(
      screen.getByRole("gridcell", { name: "e4 white pawn" }),
    ).toBeDefined();
  });
  it("persists and restores custom strength and thinking time across sessions", async () => {
    await open();
    click("Open menu");
    fireEvent.change(screen.getByLabelText("Configuration"), {
      target: { value: "legit" },
    });
    fireEvent.change(screen.getByLabelText("Playing Strength"), {
      target: { value: "custom" },
    });
    const input = screen.getByLabelText("Custom Elo target", { exact: false });
    fireEvent.change(input, { target: { value: "2425" } });
    fireEvent.blur(input);
    fireEvent.change(screen.getByLabelText("Thinking time"), {
      target: { value: "800" },
    });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("simpleSettings")!)).toMatchObject(
        {
          configuration: "legit",
          playingStrength: "custom",
          customElo: 2425,
          budget: 800,
        },
      ),
    );
    cleanup();
    await open();
    click("Open menu");
    expect(
      (screen.getByLabelText("Playing Strength") as HTMLSelectElement).value,
    ).toBe("custom");
    expect(
      (
        screen.getByLabelText("Custom Elo target", {
          exact: false,
        }) as HTMLInputElement
      ).value,
    ).toBe("2425");
    expect(
      (screen.getByLabelText("Thinking time") as HTMLSelectElement).value,
    ).toBe("800");
    expect(engine().settings[0]).toMatchObject({
      configuration: "legit",
      customElo: 2425,
    });
  });
});
