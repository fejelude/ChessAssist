import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { defaults, type Candidate } from "../src/types";
import {
  normalizeTrainingPreferences,
  selectTrainingMove,
  strengthPresets,
  strengthProfile,
} from "../src/engine/legit";

const settings = { ...defaults, configuration: "legit" as const };
const candidate = (move: string, cp: number, rank = 1): Candidate => ({
  rank,
  depth: 8,
  cp,
  pv: [move],
  nodes: 100,
  time: 10,
  nps: 10000,
});

describe("Legit training preferences", () => {
  it("migrates old settings without opting into Legit, rejects invalid values and bounds custom targets", () => {
    for (const saved of [
      null,
      7,
      "legit",
      { budget: 1800 },
      { configuration: "other", playingStrength: "unknown", customElo: "2200" },
    ])
      expect(normalizeTrainingPreferences(saved)).toEqual({
        configuration: "stockfish",
        playingStrength: "default",
        customElo: 1800,
      });
    for (const customElo of [NaN, Infinity, -Infinity])
      expect(normalizeTrainingPreferences({ customElo }).customElo).toBe(1800);
    expect(normalizeTrainingPreferences({ customElo: 1 }).customElo).toBe(400);
    expect(normalizeTrainingPreferences({ customElo: 9999 }).customElo).toBe(
      3000,
    );
    expect(normalizeTrainingPreferences({ customElo: 2250.6 }).customElo).toBe(
      2251,
    );
  });
  it("keeps Stockfish untouched and smoothly interpolates every supported custom target", () => {
    expect(strengthProfile(defaults)).toBeUndefined();
    let previous = strengthProfile({
      ...settings,
      playingStrength: "custom",
      customElo: 400,
    })!;
    for (let customElo = 401; customElo <= 3000; customElo++) {
      const current = strengthProfile({
        ...settings,
        playingStrength: "custom",
        customElo,
      })!;
      expect(current.depth).toBeGreaterThanOrEqual(previous.depth);
      expect(current.nodes).toBeGreaterThanOrEqual(previous.nodes);
      expect(current.temperature).toBeLessThanOrEqual(previous.temperature);
      expect(current.maxLoss).toBeLessThanOrEqual(previous.maxLoss);
      expect(current.awareness).toBeGreaterThanOrEqual(previous.awareness);
      previous = current;
    }
    expect(strengthProfile(settings)).toEqual(
      strengthProfile({ ...settings, playingStrength: "advanced" }),
    );
  });
});

describe("human-style candidate selection", () => {
  const fen = new Chess().fen();
  const lines = [
    candidate("e2e4", 30),
    candidate("d2d4", 20, 2),
    candidate("g1f3", 0, 3),
    candidate("a2a3", -100, 4),
  ];
  it("reduces expected evaluation loss across all named strengths on a controlled candidate set", () => {
    let previousLoss = Infinity;
    for (const preset of [...strengthPresets]
      .reverse()
      .filter((p) => p.target)) {
      const profile = strengthProfile({
        ...settings,
        playingStrength: preset.id,
      })!;
      let loss = 0;
      const moves = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const selected = selectTrainingMove(
          fen,
          lines,
          profile,
          () => (i + 0.5) / 200,
        )[0];
        loss += 30 - selected.cp!;
        moves.add(selected.pv[0]);
        expect(30 - selected.cp!).toBeLessThanOrEqual(profile.maxLoss);
      }
      loss /= 200;
      expect(loss).toBeLessThanOrEqual(previousLoss + 0.1);
      expect(moves.size).toBeGreaterThan(1);
      previousLoss = loss;
    }
  });
  it("keeps the selected PV and its score together without mutating engine lines", () => {
    const before = JSON.stringify(lines);
    const selected = selectTrainingMove(
      fen,
      lines,
      strengthProfile({ ...settings, playingStrength: "beginner" })!,
      () => 0.999,
    )[0];
    expect(selected.pv[0]).toBe("a2a3");
    expect(selected.cp).toBe(-100);
    expect(selected.rank).toBe(1);
    expect(JSON.stringify(lines)).toBe(before);
  });
  it("compares only exact, equally deep legal lines and handles empty input", () => {
    const p = strengthProfile(settings)!;
    expect(selectTrainingMove(fen, [], p)).toEqual([]);
    const selected = selectTrainingMove(
      fen,
      [
        candidate("a1a8", 5000),
        { ...candidate("d2d4", 5000), bound: "lowerbound" },
        { ...candidate("g1f3", 5000), depth: 7 },
        candidate("e2e4", 0),
      ],
      p,
      () => 0.999,
    );
    expect(selected[0].pv[0]).toBe("e2e4");
  });
  it("takes a recognized winning mate, avoids losing mates when an alternative exists and resists when all moves lose", () => {
    const p = strengthProfile(settings)!;
    const mate = (move: string, n: number) => ({
      ...candidate(move, 0),
      cp: undefined,
      mate: n,
    });
    expect(
      selectTrainingMove(
        fen,
        [mate("e2e4", 3), mate("d2d4", 1), candidate("g1f3", 900)],
        p,
      )[0].pv[0],
    ).toBe("d2d4");
    expect(
      selectTrainingMove(fen, [mate("e2e4", -3), candidate("d2d4", -900)], p)[0]
        .pv[0],
    ).toBe("d2d4");
    expect(
      selectTrainingMove(fen, [mate("e2e4", -3), mate("d2d4", -7)], p)[0].pv[0],
    ).toBe("d2d4");
  });
  it.each([
    ["r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1", "e8g8"],
    ["4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5d6"],
    ["4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7a8n"],
    ["4k3/8/8/8/8/8/p7/4K3 b - - 0 1", "a2a1q"],
  ])("preserves a legal special move and the source FEN: %s", (fen, uci) => {
    const before = new Chess(fen).fen();
    expect(
      selectTrainingMove(
        fen,
        [candidate(uci, 0)],
        strengthProfile(settings)!,
      )[0].pv[0],
    ).toBe(uci);
    expect(new Chess(fen).fen()).toBe(before);
  });
});
