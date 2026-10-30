import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import {
  readFile,
  stat,
  mkdir,
  cp,
  mkdtemp,
  writeFile,
  readdir,
} from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve("."),
  out = resolve("test-results");
await mkdir(out, { recursive: true });
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      `.${new URL(req.url, "http://localhost").pathname}`,
    );
    if (!path.startsWith(root + "/")) throw Error("path");
    const file = (await stat(path)).isDirectory()
      ? join(path, "index.html")
      : path;
    res.setHeader(
      "Content-Type",
      mime[extname(file)] || "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const address = `http://127.0.0.1:${server.address().port}`;
const temp = await mkdtemp(join(tmpdir(), "chess-assist-qa-")),
  extension = join(temp, "extension");
await cp("dist", extension, { recursive: true });
// Test-only permissions enable controlled localhost automation without interacting
// with Chrome's toolbar. The distributed manifest retains activeTab only.
const manifest = JSON.parse(
  await readFile(join(extension, "manifest.json"), "utf8"),
);
manifest.host_permissions = ["<all_urls>"];
await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
await build({
  stdin: {
    contents:
      "export {defaultTemplates} from './src/recognition/templates'; export {recognize} from './src/recognition/vision';",
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  outfile: join(extension, "qa-bridge.js"),
});
let context;
const report = { checks: [], errors: [] };
try {
  context = await chromium.launchPersistentContext(join(temp, "profile"), {
    executablePath: process.env.CHROME_PATH || undefined,
    channel: process.env.CHROME_PATH ? undefined : "chromium",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 1100, height: 1000 },
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = worker.url().split("/")[2];
  const app = await context.newPage();
  app.on("pageerror", (e) => report.errors.push(e.message));
  app.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  await app.setViewportSize({ width: 420, height: 1100 });
  await app.goto(`chrome-extension://${id}/index.html`);
  const click = async (name) =>
    app.getByRole("button", { name, exact: true }).click();
  const move = async (from, to) => {
    await app.getByRole("gridcell", { name: new RegExp(`^${from} `) }).click();
    await app.getByRole("gridcell", { name: new RegExp(`^${to} `) }).click();
  };
  const recommendation = () =>
    app.locator(".move-arrow").waitFor({ timeout: 20000 });
  await click("Open menu");
  await click("Practice board");
  await recommendation();
  report.checks.push(
    "Extension page opens and real packaged Stockfish returns a visible recommendation automatically under MV3 CSP.",
  );
  assert.equal(
    await app.getByRole("button", { name: "Analyze", exact: true }).count(),
    0,
  );
  await click("Black");
  await app.locator(".simple-move").filter({ hasText: "Waiting" }).waitFor();
  assert.equal(await app.locator(".move-arrow").count(), 0);
  await move("e2", "e4");
  await recommendation();
  report.checks.push(
    "Black selection waits for White and analyzes a manually entered opponent move.",
  );
  await click("White");
  assert.equal(await app.locator(".move-arrow").count(), 0);
  await move("e7", "e5");
  await recommendation();
  await move("d2", "d4");
  assert.equal(await app.locator(".move-arrow").count(), 0);
  await move("d7", "d5");
  await recommendation();
  report.checks.push(
    "White selection, independent legal deviations, repeated moves, and turn-based clearing work.",
  );
  await click("Pause");
  assert.equal(await app.locator(".move-arrow").count(), 0);
  await click("Start");
  await recommendation();
  await click("Open menu");
  await click("Correct Position");
  await click("Erase piece");
  await app
    .getByRole("region", { name: "Edit position" })
    .getByRole("gridcell", { name: "a2 white pawn", exact: true })
    .click();
  await click("Save and continue");
  await recommendation();
  await app.getByRole("gridcell", { name: "a2 empty", exact: true }).waitFor();
  report.checks.push(
    "Pause/Start and position correction resume real engine analysis without reinstalling.",
  );
  await click("Edit");
  await app
    .getByRole("gridcell", { name: "g8 black knight", exact: true })
    .locator("img")
    .dragTo(app.getByRole("gridcell", { name: "a5 empty", exact: true }));
  await app
    .getByRole("gridcell", { name: "a5 black knight", exact: true })
    .waitFor();
  await app
    .getByRole("gridcell", { name: "b2 white pawn", exact: true })
    .click();
  await app.getByRole("gridcell", { name: "b5 empty", exact: true }).click();
  await app
    .getByRole("gridcell", { name: "b5 white pawn", exact: true })
    .waitFor();
  await click("Save and continue");
  await recommendation();
  report.checks.push(
    "Inline Edit allows arbitrary moves for both colors via native drag and click, then validates and resumes Stockfish.",
  );

  await click("Open menu");
  await app.getByText("Load a saved position", { exact: true }).click();
  await app
    .getByRole("textbox", { name: "Saved FEN" })
    .fill("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  await click("Load position");
  await move("a7", "a8");
  await click("Knight");
  await app
    .getByRole("gridcell", { name: "a8 white knight", exact: true })
    .waitFor();
  await click("Open menu");
  await app.getByText("Load a saved position", { exact: true }).click();
  await app
    .getByRole("textbox", { name: "Saved FEN" })
    .fill("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
  await click("Load position");
  await app.locator(".simple-move").filter({ hasText: "Game over" }).waitFor();
  assert.equal(await app.locator(".move-arrow").count(), 0);
  report.checks.push(
    "Underpromotion and terminal checkmate hide obsolete recommendations.",
  );
  const fixture = await context.newPage();
  await fixture.goto(`${address}/fixtures/training.html`);
  await fixture.waitForFunction(() => window.fixture);
  await fixture.bringToFront();
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    `${address}/fixtures/training.html`,
  );
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }, tabId);
  await app.evaluate(() => {
    document.querySelector('[aria-label="Open menu"]').click();
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === "Reconnect to webpage")
      .click();
  });
  await app.waitForFunction(
    () => Boolean(document.querySelector(".move-arrow")),
    {},
    { timeout: 20000 },
  );
  await fixture.locator("#next").click();
  await app.waitForFunction(
    () => document.querySelector(".simple-move")?.textContent === "Waiting",
  );
  await fixture.locator("#next").click();
  await app.waitForFunction(
    () => Boolean(document.querySelector(".move-arrow")),
    {},
    { timeout: 20000 },
  );
  report.checks.push(
    "Actual content-script mutations synchronize the backgrounded extension controller and trigger fresh real engine analysis.",
  );
  await fixture.locator("#reset").click();
  const detect = () =>
    worker.evaluate(
      async (tabId) =>
        (await chrome.tabs.sendMessage(tabId, { type: "CA_SCAN" })).detection,
      tabId,
    );
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  for (const renderer of [
    "HTML",
    "Shadow DOM",
    "SVG",
    "Canvas",
    "Image",
    "WebGL",
  ]) {
    await fixture.locator("#renderer").selectOption(renderer);
    const d = await detect();
    assert.equal(d.fen, start, `${renderer}: full FEN`);
    report.checks.push(`${renderer}: source extraction from board metadata.`);
  }
  for (const renderer of ["HTML", "Shadow DOM", "SVG"]) {
    await fixture.locator("#renderer").selectOption(renderer);
    await fixture.locator("#metadata").uncheck();
    const d = await detect();
    assert.equal(d.placement, start.split(" ")[0], `${renderer}: pieces`);
    assert.equal(d.orientation, "w");
    assert.equal(d.turn, undefined);
    report.checks.push(
      `${renderer}: geometric piece recognition without FEN, hidden turn remains unknown.`,
    );
  }
  await fixture.locator("#flip").check();
  assert.equal((await detect()).orientation, "b");
  assert.equal((await detect()).placement, start.split(" ")[0]);
  report.checks.push(
    "Black-bottom DOM board preserves canonical piece coordinates.",
  );
  await fixture.locator("#flip").uncheck();
  await fixture.locator("#renderer").selectOption("Canvas");
  await fixture.waitForTimeout(100);
  const screenshot = await worker.evaluate(async () =>
    chrome.tabs.captureVisibleTab(undefined, { format: "png" }),
  );
  const d = await detect();
  await app.bringToFront();
  const vision = await app
    .evaluate(
      async ({ url, det, workerPath }) => {
        const { defaultTemplates } = await import(
          chrome.runtime.getURL("qa-bridge.js")
        );
        const templates = await defaultTemplates();
        return await new Promise((resolve, reject) => {
          const w = new Worker(chrome.runtime.getURL(workerPath), {
            type: "module",
          });
          w.onmessage = (e) => {
            w.terminate();
            resolve(e.data);
          };
          w.onerror = (e) => reject(new Error(e.message));
          w.postMessage({
            id: 1,
            url,
            bounds: det.bounds,
            viewport: det.viewport,
            templates,
          });
        });
      },
      {
        url: screenshot,
        det: d,
        workerPath:
          "assets/" +
          (await readdir(join(extension, "assets"))).find((n) =>
            n.startsWith("vision.worker-"),
          ),
      },
    )
    .catch((e) => {
      throw e;
    });
  // Worker is packaged in assets/, not the extension root.
  assert.ok(!vision.error, vision.error);
  assert.equal(vision.result.cells.length, 64);
  report.checks.push(
    `Canvas screenshot: visual worker returns 64 squares (${vision.result.cells.filter((c) => c.code).length} pieces recognized, ${vision.result.issues.length ? "correction requested" : "all classified"}).`,
  );
  await app.screenshot({ path: join(out, "review.png"), fullPage: true });
  assert.deepEqual(report.errors, [], "No uncaught extension UI or CSP errors");
  report.passed = true;
  await writeFile(
    join(out, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  report.passed = false;
  report.failure = String(e.stack || e);
  await writeFile(
    join(out, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await context?.close();
  await new Promise((r) => server.close(r));
}
