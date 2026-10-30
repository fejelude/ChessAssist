// @vitest-environment jsdom
import { it, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  configure,
} from "@testing-library/react";
import { Worker as NodeWorker } from "node:worker_threads";
import { resolve } from "node:path";
import App from "../src/App";
configure({
  getElementError: (m) => new Error(m || "Real engine UI assertion failed"),
});
const bootstrap = `const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs'),vm=require('node:vm');
const scope={URL,WebAssembly,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,SharedArrayBuffer,ReadableStream,Headers,Response,performance,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,WorkerGlobalScope:class{},onmessage:null,name:'',location:{hash:'',origin:'https://chess-assist.local',pathname:'/engine/stockfish.js',href:'https://chess-assist.local/engine/stockfish.js'},postMessage:m=>parentPort.postMessage(m),close:()=>parentPort.close()};scope.self=scope;scope.fetch=async()=>new Response(fs.readFileSync(workerData.wasm),{headers:{'content-type':'application/wasm'}});vm.runInContext(fs.readFileSync(workerData.js,'utf8'),vm.createContext(scope));parentPort.on('message',data=>scope.onmessage({data}));`;
class ActualWorker {
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  worker: NodeWorker;
  constructor() {
    this.worker = new NodeWorker(bootstrap, {
      eval: true,
      workerData: {
        js: resolve("dist/engine/stockfish.js"),
        wasm: resolve("dist/engine/stockfish.wasm"),
      },
    });
    this.worker.on("message", (data) => this.onmessage?.({ data }));
    this.worker.on("error", (e) => this.onerror?.({ message: e.message }));
  }
  postMessage(data: string) {
    this.worker.postMessage(data);
  }
  terminate() {
    void this.worker.terminate();
  }
}
it("connects the real React UI to the packaged WASM worker for both colors and independent moves (not a browser test)", async () => {
  const previous = globalThis.Worker;
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: ActualWorker,
  });
  localStorage.clear();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  try {
    render(<App />);

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
    click("Open menu");
    click("Practice board");
    await waitFor(
      () => expect(document.querySelector(".move-arrow")).not.toBeNull(),
      { timeout: 16000 },
    );
    expect(document.querySelector(".simple-move")?.textContent).toMatch(
      /[a-h][1-8]/,
    );
    click("Black");
    expect(document.querySelector(".move-arrow")).toBeNull();
    move("e2", "e4");
    await waitFor(
      () => expect(document.querySelector(".move-arrow")).not.toBeNull(),
      { timeout: 10000 },
    );
    move("a7", "a6");
    expect(document.querySelector(".move-arrow")).toBeNull();
    move("a2", "a3");
    await waitFor(
      () => expect(document.querySelector(".move-arrow")).not.toBeNull(),
      { timeout: 10000 },
    );
    click("Edit");
    click("Clear board");
    click("Add white king");
    fireEvent.click(screen.getByRole("gridcell", { name: "e1 empty" }));
    click("Add black king");
    fireEvent.click(screen.getByRole("gridcell", { name: "e8 empty" }));
    click("Add black rook");
    fireEvent.click(screen.getByRole("gridcell", { name: "h8 empty" }));
    click("Save and continue");
    await waitFor(
      () => expect(document.querySelector(".move-arrow")).not.toBeNull(),
      { timeout: 10000 },
    );
    expect(
      screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
    ).toBe(true);
    click("Pause");
    expect(document.querySelector(".move-arrow")).toBeNull();
    click("Start");
    await waitFor(
      () => expect(document.querySelector(".move-arrow")).not.toBeNull(),
      { timeout: 10000 },
    );
  } finally {
    cleanup();
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: previous,
    });
  }
}, 30000);
