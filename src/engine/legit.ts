import { Chess } from "chess.js";
import type { Candidate, Settings, StrengthPreset } from "../types";

export const strengthPresets: ReadonlyArray<{
  id: StrengthPreset;
  label: string;
  target?: number;
}> = [
  { id: "default", label: "Default Legit" },
  {
    id: "elite-gm",
    label: "Elite Grandmaster (Super GM) · 2700+",
    target: 2750,
  },
  { id: "gm", label: "Grandmaster (GM) · 2500–2699", target: 2600 },
  { id: "im", label: "International Master (IM) · 2400–2499", target: 2450 },
  { id: "fm", label: "FIDE Master (FM) · 2300–2399", target: 2350 },
  { id: "cm", label: "Candidate Master (CM) · 2200–2299", target: 2250 },
  { id: "expert", label: "Expert · 2000–2199", target: 2100 },
  { id: "advanced", label: "Advanced · 1800–1999", target: 1900 },
  { id: "club", label: "Club Player · 1600–1799", target: 1700 },
  { id: "intermediate", label: "Intermediate · 1200–1599", target: 1400 },
  { id: "beginner", label: "Beginner · Below 1200", target: 1000 },
  { id: "custom", label: "Custom · User-defined" },
];

export interface TrainingPreferences {
  configuration: "stockfish" | "legit";
  playingStrength: StrengthPreset;
  customElo: number;
}

export function normalizeTrainingPreferences(
  value: unknown,
): TrainingPreferences {
  const saved = (
    value && typeof value === "object" ? value : {}
  ) as Partial<Settings>;
  return {
    configuration: saved.configuration === "legit" ? "legit" : "stockfish",
    playingStrength: strengthPresets.some((p) => p.id === saved.playingStrength)
      ? saved.playingStrength!
      : "default",
    customElo:
      typeof saved.customElo === "number" && Number.isFinite(saved.customElo)
        ? Math.max(400, Math.min(3000, Math.round(saved.customElo)))
        : 1800,
  };
}

export interface StrengthProfile {
  target: number;
  depth: number;
  nodes: number;
  candidates: number;
  temperature: number;
  maxLoss: number;
  awareness: number;
}

// Provisional engineering parameters, NOT a measured FIDE conversion. See
// docs/legit-strength.md for evidence, limitations and the calibration protocol.
const anchors: StrengthProfile[] = [
  {
    target: 400,
    depth: 1,
    nodes: 300,
    candidates: 20,
    temperature: 240,
    maxLoss: 900,
    awareness: 0,
  },
  {
    target: 1000,
    depth: 3,
    nodes: 1500,
    candidates: 16,
    temperature: 140,
    maxLoss: 500,
    awareness: 0.15,
  },
  {
    target: 1400,
    depth: 5,
    nodes: 5000,
    candidates: 12,
    temperature: 85,
    maxLoss: 300,
    awareness: 0.35,
  },
  {
    target: 1700,
    depth: 7,
    nodes: 15000,
    candidates: 10,
    temperature: 50,
    maxLoss: 180,
    awareness: 0.5,
  },
  {
    target: 1900,
    depth: 9,
    nodes: 30000,
    candidates: 8,
    temperature: 32,
    maxLoss: 120,
    awareness: 0.65,
  },
  {
    target: 2100,
    depth: 11,
    nodes: 60000,
    candidates: 7,
    temperature: 22,
    maxLoss: 85,
    awareness: 0.75,
  },
  {
    target: 2250,
    depth: 12,
    nodes: 90000,
    candidates: 6,
    temperature: 16,
    maxLoss: 65,
    awareness: 0.82,
  },
  {
    target: 2350,
    depth: 13,
    nodes: 120000,
    candidates: 5,
    temperature: 12,
    maxLoss: 50,
    awareness: 0.87,
  },
  {
    target: 2450,
    depth: 14,
    nodes: 160000,
    candidates: 5,
    temperature: 9,
    maxLoss: 40,
    awareness: 0.91,
  },
  {
    target: 2600,
    depth: 16,
    nodes: 240000,
    candidates: 4,
    temperature: 6,
    maxLoss: 30,
    awareness: 0.96,
  },
  {
    target: 2750,
    depth: 18,
    nodes: 360000,
    candidates: 4,
    temperature: 4,
    maxLoss: 20,
    awareness: 1,
  },
  {
    target: 3000,
    depth: 20,
    nodes: 500000,
    candidates: 4,
    temperature: 2,
    maxLoss: 10,
    awareness: 1,
  },
];

export function strengthProfile(
  settings: Settings,
): StrengthProfile | undefined {
  const s = normalizeTrainingPreferences(settings);
  if (s.configuration !== "legit") return;
  // No pre-existing Legit mode exists in the base repository. Its default is
  // a neutral, unlabelled profile, with no claimed rating.
  const target =
    s.playingStrength === "custom"
      ? s.customElo
      : (strengthPresets.find((p) => p.id === s.playingStrength)?.target ??
        1900);
  const upper = anchors.findIndex((a) => a.target >= target);
  if (upper === 0) return { ...anchors[0] };
  const a = anchors[upper - 1],
    b = anchors[upper];
  const t = (target - a.target) / (b.target - a.target);
  const mix = (key: keyof StrengthProfile) => a[key] + t * (b[key] - a[key]);
  return {
    target,
    depth: Math.round(mix("depth")),
    nodes: Math.round(mix("nodes")),
    candidates: Math.round(mix("candidates")),
    temperature: mix("temperature"),
    maxLoss: mix("maxLoss"),
    awareness: mix("awareness"),
  };
}

const pieceValue = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
function positionalPrior(fen: string, uci: string, awareness: number): number {
  const c = new Chess(fen);
  const m = c.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4],
  });
  // Salient moves are attractive to less experienced players; stronger profiles
  // give more weight to development, king safety and loose-piece recognition.
  let prior = m.captured
    ? (1 - awareness) * Math.min(24, pieceValue[m.captured] / 12)
    : 0;
  if (m.san.includes("+")) prior += (1 - awareness) * 10;
  if (m.isKingsideCastle() || m.isQueensideCastle()) prior += awareness * 12;
  if (Number(fen.split(" ")[5]) <= 10) {
    if ((m.piece === "n" || m.piece === "b") && /[18]$/.test(m.from))
      prior += awareness * 8;
    if (m.piece === "q") prior -= awareness * 8;
    if (m.piece === "p" && /[de][45]/.test(m.to)) prior += awareness * 6;
  }
  if (c.isAttacked(m.to, c.turn()) && !c.isAttacked(m.to, m.color))
    prior -= awareness * Math.min(40, pieceValue[m.piece] / 10);
  return prior;
}

/** Select only among legal, exact, equally deep evaluations. Never publish a
 * transient engine-best line as the selected training move. Randomness is
 * injected for reproducible statistical tests; production uses Math.random. */
export function selectTrainingMove(
  fen: string,
  lines: Candidate[],
  profile: StrengthProfile,
  random: () => number = Math.random,
): Candidate[] {
  const legal = lines.filter((line) => {
    if (line.bound) return false;
    try {
      const move = line.pv[0];
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return false;
      new Chess(fen).move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move[4],
      });
      return (
        line.mate !== undefined ||
        (line.cp !== undefined && Number.isFinite(line.cp))
      );
    } catch {
      return false;
    }
  });
  if (!legal.length) return [];
  const depth = Math.max(...legal.map((l) => l.depth));
  const coherent = legal.filter((l) => l.depth === depth);
  const winningMates = coherent.filter(
    (l) => l.mate !== undefined && l.mate > 0,
  );
  // Do not randomly discard a mate the search has already recognized.
  if (winningMates.length) {
    const best = winningMates.sort((a, b) => a.mate! - b.mate!)[0];
    return [{ ...best, rank: 1 }];
  }
  const finite = coherent.filter(
    (l) => l.cp !== undefined && l.mate === undefined,
  );
  if (!finite.length) {
    // Every evaluated move loses by mate: prefer the longest resistance.
    const best = coherent.sort(
      (a, b) => Math.abs(b.mate!) - Math.abs(a.mate!),
    )[0];
    return [{ ...best, rank: 1 }];
  }
  const bestScore = Math.max(...finite.map((l) => l.cp!));
  const pool = finite.filter((l) => bestScore - l.cp! <= profile.maxLoss);
  // A small evaluation gap means ambiguity; a clear tactical gap concentrates
  // probability on the necessary move. Priors cannot bypass the loss ceiling.
  const weights = pool.map((l) =>
    Math.exp(
      (l.cp! - bestScore + positionalPrior(fen, l.pv[0], profile.awareness)) /
        profile.temperature,
    ),
  );
  let ticket =
    Math.max(0, Math.min(1, random())) * weights.reduce((a, b) => a + b, 0);
  const selected =
    pool.find((_, i) => (ticket -= weights[i]) < 0) ?? pool[pool.length - 1];
  return [{ ...selected, rank: 1 }];
}
