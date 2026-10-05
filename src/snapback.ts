// Pure logic for the simulation: editor positions, the rewind buffer and the rule-based card.

export type Files = Record<string, { saved: string; text: string }>;
export type EditorState = { t: number; file: string; line: number; col: number; files: Files };
export type Card = { headline: string; next: string; facts: string };

export function posToLineCol(text: string, pos: number) {
  const before = text.slice(0, pos).split("\n");
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

export function lineColToPos(text: string, line: number, col: number) {
  const lines = text.split("\n");
  const row = Math.min(Math.max(line, 1), lines.length) - 1;
  let pos = 0;
  for (let i = 0; i < row; i++) pos += lines[i].length + 1;
  return pos + Math.min(Math.max(col, 1) - 1, lines[row].length);
}

// Rewind: the newest recorded state that is not later than time t.
export function stateAsOf(history: EditorState[], t: number): EditorState {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].t <= t) return history[i];
  return history[0];
}

export function unsavedLines(f: { saved: string; text: string }) {
  const a = f.saved.split("\n");
  const b = f.text.split("\n");
  let n = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

const SYMBOL =
  /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(|class\s+(\w+)|(?:test|it|describe)\(\s*["'`](.+?)["'`]|#+\s+(.+))/;
const NOTE = /\b(FIXME|TODO):\s*(.+?)\s*(?:-->|\*\/)?\s*$/;

function enclosingSymbol(lines: string[], line: number) {
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = SYMBOL.exec(lines[i]);
    if (!m) continue;
    if (m[1] || m[2]) return `${m[1] || m[2]}()`;
    return m[3] || (m[4] ? `"${m[4]}"` : m[5]);
  }
  return null;
}

function nearestNote(lines: string[], line: number, kind: "FIXME" | "TODO") {
  let best: { text: string; dist: number } | null = null;
  lines.forEach((l, i) => {
    const m = NOTE.exec(l);
    const dist = Math.abs(i + 1 - line);
    if (m && m[1] === kind && (!best || dist < best.dist)) best = { text: m[2].replace(/\.$/, ""), dist };
  });
  return (best as { text: string } | null)?.text ?? null;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// "You were fixing X in file Y. Next: Z", from simple rules. No model involved.
export function buildCard(s: EditorState): Card {
  const f = s.files[s.file];
  const lines = f.text.split("\n");
  const symbol = enclosingSymbol(lines, s.line);
  const fixme = nearestNote(lines, s.line, "FIXME");
  const todo = nearestNote(lines, s.line, "TODO");
  const dirty = unsavedLines(f);
  const where = symbol ?? `line ${s.line}`;

  const headline = fixme
    ? `You were fixing ${lowerFirst(fixme)} in ${s.file}`
    : `You were ${dirty ? "editing" : "reading"} ${where} in ${s.file}`;
  const next = todo
    ? `Next: ${lowerFirst(todo)}`
    : dirty
      ? "Next: save your unsaved edits and run the code"
      : `Next: carry on from line ${s.line}`;
  const facts = [
    s.file,
    symbol,
    `line ${s.line}, col ${s.col}`,
    dirty ? `${dirty} unsaved line${dirty > 1 ? "s" : ""}` : "no unsaved edits",
  ]
    .filter(Boolean)
    .join(" · ");
  return { headline, next, facts };
}

const file = (saved: string, text = saved) => ({ saved, text });

const AUTH_SAVED = `import { loadSession } from "./session.js";

export function validateSession(token) {
  const session = loadSession(token);
  // FIXME: the null check for a missing session
  if (session.expiresAt < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  // TODO: add the unit test for a missing session
  return { ok: true, user: session.user };
}

export function signOut(token) {
  const session = loadSession(token);
  session.expiresAt = 0;
  return { ok: true };
}
`;

// auth.js starts with one unsaved edit (the half-finished null check) so the demo needs no typing.
export const SEED: Files = {
  "auth.js": file(AUTH_SAVED, AUTH_SAVED.replace("if (session.expiresAt", "if (!session || session.expiresAt")),
  "session.js": file(`const sessions = new Map();

export function loadSession(token) {
  return sessions.get(token) ?? null;
}

// TODO: expire old sessions on a timer
export function saveSession(token, user, ttlMs = 3600000) {
  sessions.set(token, { user, expiresAt: Date.now() + ttlMs });
}
`),
  "auth.test.js": file(`import { validateSession } from "./auth.js";

test("rejects an expired session", () => {
  const result = validateSession("expired-token");
  expect(result.ok).toBe(false);
});

// TODO: cover the missing-session case
`),
  "notes.md": file(`# Sprint notes

- Auth bug: crash when the session is missing
- Demo on Friday

## Later
TODO: ask the team about token rotation
`),
};
export const START = { file: "auth.js", line: 6, col: 19 };
