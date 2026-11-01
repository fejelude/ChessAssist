import { Worker } from "node:worker_threads";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import { Chess } from "chess.js";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "chess-assist-wasm-"));
await build({
  entryPoints: ["src/engine/uci.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(temp, "engine.mjs"),
});
const { Engine } = await import(join(temp, "engine.mjs"));
await build({
  entryPoints: ["src/engine/legit.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(temp, "legit.mjs"),
});
const { strengthPresets } = await import(join(temp, "legit.mjs"));
const bootstrap = `const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const scope={URL,WebAssembly,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,SharedArrayBuffer,ReadableStream,Headers,Response,performance,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,WorkerGlobalScope:class{},onmessage:null,name:'',location:{hash:'',origin:'https://chess-assist.local',pathname:'/engine/stockfish.js',href:'https://chess-assist.local/engine/stockfish.js'},postMessage:m=>parentPort.postMessage(m),close:()=>parentPort.close()};
scope.self=scope;scope.fetch=async url=>{if(!String(url).endsWith('stockfish.wasm'))throw Error('Unexpected external fetch');return new Response(fs.readFileSync(workerData.wasm),{headers:{'content-type':'application/wasm'}});};
const context=vm.createContext(scope);vm.runInContext(fs.readFileSync(workerData.js,'utf8'),context,{filename:workerData.js});parentPort.on('message',data=>scope.onmessage({data}));`;
await writeFile(join(temp, "worker.cjs"), bootstrap);
class BrowserWorkerAdapter {
  onmessage = null;
  onerror = null;
  constructor() {
    this.worker = new Worker(join(temp, "worker.cjs"), {
      workerData: {
        js: resolve("dist/engine/stockfish.js"),
        wasm: resolve("dist/engine/stockfish.wasm"),
      },
    });
    this.worker.on("message", (data) => this.onmessage?.({ data }));
    this.worker.on("error", (e) => this.onerror?.({ message: e.message }));
  }
  postMessage(data) {
    this.worker.postMessage(data);
  }
  terminate() {
    void this.worker.terminate();
  }
}
const engine = new Engine(() => new BrowserWorkerAdapter());
const settings = {
  preset: "fast",
  depth: 12,
  time: 1200,
  multiPV: 3,
  hash: 16,
};
let receive = () => {};
engine.onResult = (r) => receive(r);
engine.onStatus = (s) => console.log(s);
const waitSearch = (fen, options = settings) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Engine search timed out")),
      15000,
    );
    receive = (r) => {
      if (r.fen !== fen) return;
      if (r.finished) {
        clearTimeout(timeout);
        resolve(r);
      }
    };
    void engine.analyze(fen, options).catch(reject);
  });
const report = {
  engine: "Stockfish.js 19.0.1 lite single WASM",
  runtime:
    "Packaged browser worker script in Node worker thread with web API harness; no browser CSP or Chrome lifecycle emulation",
  checks: [],
};
try {
  const c = new Chess(),
    start = await waitSearch(c.fen());
  assert.equal(start.lines.length, 3);
  assert.ok(start.lines.every((l) => l.depth >= 8));
  for (const l of start.lines)
    assert.doesNotThrow(() =>
      new Chess(c.fen()).move({
        from: l.pv[0].slice(0, 2),
        to: l.pv[0].slice(2, 4),
        promotion: l.pv[0][4],
      }),
    );
  report.checks.push(
    "Three legal principal variations, completed real search, depth/time/nodes.",
  );
  c.move("e4");
  c.move("e5");
  c.move("Bc4");
  c.move("Nc6");
  c.move("Qh5");
  c.move("Nf6");
  const mate = await waitSearch(c.fen());
  assert.equal(mate.lines[0].pv[0], "h5f7");
  assert.equal(mate.lines[0].mate, 1);
  report.checks.push("Finds Qxf7# with a mate-in-one score.");
  const final = new Chess();
  final.move("a3");
  await new Promise((resolve, reject) => {
    let changed = false;
    const timer = setTimeout(
      () => reject(Error("Cancellation timed out")),
      15000,
    );
    receive = (r) => {
      if (!changed && r.lines.length) {
        changed = true;
        engine.cancel();
        void engine.analyze(new Chess().fen(), settings);
        void engine.analyze(final.fen(), settings);
        return;
      }
      if (changed && r.fen === final.fen() && r.finished) {
        clearTimeout(timer);
        assert.ok(r.lines[0].pv[0]);
        resolve();
      }
    };
    void engine.analyze(new Chess().fen(), { ...settings, preset: "infinite" });
  });
  report.checks.push(
    "Cancels infinite analysis, coalesces rapid position changes, and recovers after independent 1.a3.",
  );
  // Behavioral smoke benchmark, not a FIDE rating calibration. The reference
  // re-evaluates the selected child position rather than trusting shallow scores.
  const middle = new Chess();
  for (const move of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d3", "Bc5"])
    middle.move(move);
  const positions = [
    { name: "opening", fen: new Chess().fen() },
    { name: "middlegame", fen: middle.fen() },
    { name: "endgame-black", fen: "8/8/4k3/4p3/4P3/4K3/8/7R b - - 0 40" },
  ];
  const score = (l) =>
    l.mate === undefined ? (l.cp ?? 0) : l.mate > 0 ? 10000 : -10000;
  report.training = {
    ratingCalibration:
      "NOT performed; FIDE-style labels remain provisional training targets",
    samples: [],
  };
  for (const position of positions) {
    const reference = await waitSearch(position.fen, {
      ...settings,
      configuration: "stockfish",
      multiPV: 1,
      depth: 15,
      time: 800,
    });
    for (const preset of strengthPresets) {
      const options = {
        ...settings,
        configuration: "legit",
        playingStrength: preset.id,
        customElo: 2425,
        time: 800,
      };
      const result = await waitSearch(position.fen, options);
      assert.equal(result.lines.length, 1);
      const line = result.lines[0],
        child = new Chess(position.fen);
      assert.doesNotThrow(() =>
        child.move({
          from: line.pv[0].slice(0, 2),
          to: line.pv[0].slice(2, 4),
          promotion: line.pv[0][4],
        }),
      );
      const childScore = child.isCheckmate()
        ? 10000
        : child.isGameOver()
          ? 0
          : -score(
              (
                await waitSearch(child.fen(), {
                  ...settings,
                  configuration: "stockfish",
                  multiPV: 1,
                  depth: 15,
                  time: 800,
                })
              ).lines[0],
            );
      report.training.samples.push({
        position: position.name,
        preset: preset.id,
        move: line.pv[0],
        depth: line.depth,
        nodes: line.nodes,
        time: line.time,
        referenceLossCp: Math.max(0, score(reference.lines[0]) - childScore),
      });
    }
  }
  // A discovered mate must survive the training selection layer.
  const trainingMate = await waitSearch(c.fen(), {
    ...settings,
    configuration: "legit",
    playingStrength: "elite-gm",
  });
  assert.equal(trainingMate.lines[0].pv[0], "h5f7");
  report.checks.push(
    "All 12 Legit selections return legal moves across opening, middlegame and Black endgame; selected child positions independently re-evaluated; recognized mate retained. This is a smoke benchmark, not rating certification.",
  );
  report.passed = true;
} finally {
  engine.dispose();
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/engine-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
