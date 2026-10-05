import { useEffect, useRef, useState } from "react";
import { SEED, START, buildCard, lineColToPos, posToLineCol, stateAsOf, type Card, type EditorState, type Files } from "./snapback";

const LH = 20; // editor line height, px
const PAD = 8; // editor top padding, px
const MIN_CALL_S = 5; // shorter calls show no card
const DELIVERY_MS = 800; // simulated phone-to-laptop delay, so the rewind is visible
const RING_TIMEOUT_MS = 15000; // unanswered ringing becomes a missed call

type Device = "phone" | "laptop";
type Call = { phase: "idle" } | { phase: "ringing"; ringAt: number } | { phase: "active"; ringAt: number; answeredAt: number };
type LogEntry = { t: number; who: Device; msg: string };

const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB");
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function App() {
  const [files, setFiles] = useState<Files>(SEED);
  const [active, setActive] = useState(START.file);
  const [cursor, setCursor] = useState({ line: START.line, col: START.col });
  const [call, setCall] = useState<Call>({ phase: "idle" });
  const [card, setCard] = useState<Card | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [flash, setFlash] = useState({ key: 0, file: "", line: 0 });
  const [now, setNow] = useState(Date.now());

  const history = useRef<EditorState[]>([]); // the daemon's rolling record of recent work
  const snap = useRef<EditorState | null>(null); // snapshot of the open interruption
  const live = useRef({ call, card }); // latest values, for timers
  live.current = { call, card };
  const ta = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const laptop = useRef<HTMLElement>(null);
  const seen = useRef({ mounted: false, flash: 0 });

  // Daemon: record every editor state with a timestamp.
  useEffect(() => {
    history.current.push({ t: Date.now(), file: active, ...cursor, files });
    if (history.current.length > 500) history.current.shift();
  }, [files, active, cursor]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (call.phase !== "ringing") return;
    const id = setTimeout(() => dropCall("Call missed; no card shown"), RING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [call.phase]);

  // Put the caret where the state says after a file switch or a restore.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    const pos = lineColToPos(files[active].text, cursor.line, cursor.col);
    el.setSelectionRange(pos, pos);
    if (!seen.current.mounted) {
      seen.current.mounted = true;
      return;
    }
    if (!matchMedia("(pointer: coarse)").matches) el.focus({ preventScroll: true });
    if (flash.key !== seen.current.flash) {
      seen.current.flash = flash.key;
      const box = scroller.current!;
      box.scrollTop = Math.max(0, (cursor.line - 1) * LH - box.clientHeight / 2);
      laptop.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [active, flash.key]);

  const addLog = (who: Device, msg: string) => setLog((l) => [{ t: Date.now(), who, msg }, ...l].slice(0, 60));

  function ring() {
    const ringAt = Date.now();
    setCall({ phase: "ringing", ringAt });
    addLog("phone", "Call started (ringing); event sent to laptop");
    setTimeout(() => {
      if (live.current.call.phase === "idle") return addLog("laptop", "Call event arrived after the call was over; nothing saved");
      if (snap.current) return addLog("laptop", "Call event received; a resume card is already waiting, so the original snapshot is kept");
      const s = stateAsOf(history.current, ringAt);
      snap.current = s;
      addLog("laptop", `Call event received ${Date.now() - ringAt} ms late; rewound to just before the call and saved snapshot: ${s.file}, line ${s.line}, col ${s.col}`);
    }, DELIVERY_MS);
  }

  // Missed, declined or too short: the interruption is recorded but no card is shown.
  function dropCall(msg: string) {
    setCall({ phase: "idle" });
    addLog("phone", msg);
    if (!live.current.card) snap.current = null;
  }

  function answer() {
    if (call.phase !== "ringing") return;
    setCall({ phase: "active", ringAt: call.ringAt, answeredAt: Date.now() });
    addLog("phone", "Call answered");
  }

  function endCall() {
    if (call.phase !== "active") return;
    const secs = (Date.now() - call.answeredAt) / 1000;
    if (secs < MIN_CALL_S) return dropCall(`Call ended after ${secs.toFixed(1)} s (under ${MIN_CALL_S} s); no card shown`);
    setCall({ phase: "idle" });
    addLog("phone", `Call ended after ${Math.round(secs)} s; event sent to laptop`);
    if (!snap.current || card) return;
    setCard(buildCard(snap.current));
    addLog("laptop", "Resume card shown on phone and laptop");
  }

  function resume(from: Device) {
    const s = snap.current;
    if (!s) return;
    setFiles((f) => ({ ...f, [s.file]: { ...f[s.file], text: s.files[s.file].text } }));
    setActive(s.file);
    setCursor({ line: s.line, col: s.col });
    setFlash((f) => ({ key: f.key + 1, file: s.file, line: s.line }));
    setCard(null);
    snap.current = null;
    addLog("laptop", `Resume tapped on ${from}; restored ${s.file} at line ${s.line}, col ${s.col}, unsaved edits included`);
  }

  function dismiss(from: Device) {
    setCard(null);
    snap.current = null;
    addLog("laptop", `Card dismissed on ${from}`);
  }

  function openFile(name: string) {
    if (name === active) return;
    setActive(name);
    setCursor({ line: 1, col: 1 });
  }

  const text = files[active].text;
  const lines = text.split("\n");
  const dirty = (name: string) => files[name].text !== files[name].saved;
  const dirtyCount = Object.keys(files).filter(dirty).length;
  const reportCursor = (el: HTMLTextAreaElement) => {
    const c = posToLineCol(el.value, el.selectionStart);
    setCursor((p) => (p.line === c.line && p.col === c.col ? p : c));
  };
  const save = () => setFiles((f) => ({ ...f, [active]: { saved: f[active].text, text: f[active].text } }));
  const busy = call.phase !== "idle";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-ink pb-5">
        <div>
          <h1 className="font-serif text-5xl tracking-tight">
            Snapback<span className="text-accent">.</span>
          </h1>
          <p className="mt-1 font-serif text-xl italic">Pick up exactly where you left off</p>
        </div>
        <p className="border border-ink px-3 py-1.5 text-sm">This is a simulation of the full system</p>
      </header>

      <main className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section ref={laptop} aria-label="Laptop" className="scroll-mt-4">
          <PanelTitle name="Laptop" hint="Edit the code, move the cursor, switch files." />
          <div className="relative border border-ink bg-white">
            <div className="flex items-center gap-1.5 border-b border-ink px-3 py-2 text-xs">
              <i className="size-2.5 rounded-full border border-ink" />
              <i className="size-2.5 rounded-full border border-ink" />
              <i className="size-2.5 rounded-full bg-accent" />
              <span className="ml-2 truncate">snapback-demo: code editor (simulated VS Code)</span>
            </div>

            <div className="flex h-[420px] flex-col sm:flex-row">
              <nav aria-label="Files" className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink/20 bg-paper/60 p-2 sm:w-40 sm:flex-col sm:border-r sm:border-b-0">
                <p className="hidden px-2 pb-1 text-[10px] font-bold tracking-[0.15em] text-ink/60 sm:block">EXPLORER</p>
                {Object.keys(files).map((name) => (
                  <button
                    key={name}
                    onClick={() => openFile(name)}
                    aria-current={name === active}
                    className={`flex items-center justify-between gap-2 px-2 py-1 text-left font-mono text-xs whitespace-nowrap ${name === active ? "bg-ink text-paper" : "hover:bg-ink/10"}`}
                  >
                    {name}
                    {dirty(name) && <span title="Unsaved edits" className="size-1.5 rounded-full bg-accent" />}
                  </button>
                ))}
              </nav>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div ref={scroller} className="flex-1 overflow-auto font-mono text-[13px] leading-[20px]">
                  <div className="relative flex min-h-full w-max min-w-full py-2">
                    {flash.key > 0 && flash.file === active && (
                      <div key={flash.key} aria-hidden className="flash pointer-events-none absolute inset-x-0" style={{ top: PAD + (flash.line - 1) * LH, height: LH }} />
                    )}
                    <div aria-hidden className="sticky left-0 z-10 w-11 shrink-0 bg-white pr-3 text-right text-ink/35 select-none">
                      {lines.map((_, i) => (
                        <div key={i} className={i + 1 === cursor.line ? "font-bold text-accent" : ""}>
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    <textarea
                      ref={ta}
                      aria-label={`Code editor: ${active}`}
                      value={text}
                      rows={lines.length}
                      wrap="off"
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      style={{ width: `${Math.max(...lines.map((l) => l.length)) + 4}ch` }}
                      className="relative block flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 leading-[20px] whitespace-pre outline-none"
                      onChange={(e) => {
                        const v = e.target.value;
                        setFiles((f) => ({ ...f, [active]: { ...f[active], text: v } }));
                        reportCursor(e.target);
                      }}
                      onSelect={(e) => reportCursor(e.currentTarget)}
                      onKeyUp={(e) => reportCursor(e.currentTarget)}
                      onClick={(e) => reportCursor(e.currentTarget)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                          e.preventDefault();
                          save();
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-paper">
                  <span data-testid="cursor">
                    {active} &middot; Ln {cursor.line}, Col {cursor.col}
                  </span>
                  <span>{dirtyCount ? `${dirtyCount} unsaved file${dirtyCount > 1 ? "s" : ""}` : "All saved"}</span>
                  <button onClick={save} disabled={!dirty(active)} className="underline underline-offset-2 disabled:no-underline disabled:opacity-40">
                    Save (Ctrl+S)
                  </button>
                  <span className="ml-auto flex items-center gap-1.5">
                    <i className="size-1.5 rounded-full bg-accent" /> Daemon recording
                  </span>
                </div>
              </div>
            </div>

            {card && (
              <div className="absolute right-3 bottom-11 z-20 w-[min(21rem,calc(100%-1.5rem))]">
                <ResumeCard card={card} onResume={() => resume("laptop")} onDismiss={() => dismiss("laptop")} />
              </div>
            )}
          </div>
        </section>

        <section aria-label="Phone" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <PanelTitle name="Phone" hint="Start a call, then end it after 5 s or more." />
          <div className={`mx-auto flex h-[600px] w-[300px] max-w-full flex-col rounded-[2.75rem] border-[10px] border-ink p-4 transition-colors ${busy ? "bg-ink text-paper" : "bg-paper"}`}>
            <div aria-hidden className={`mx-auto mb-2 h-5 w-24 rounded-full ${busy ? "bg-paper/20" : "bg-ink"}`} />
            <div className="flex justify-between font-mono text-[11px] opacity-70">
              <span>{clock(now).slice(0, 5)}</span>
              <span>Paired with laptop</span>
            </div>

            {call.phase === "idle" && (
              <div className="flex min-h-0 flex-1 flex-col">
                {card ? (
                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 pb-1">
                    <ResumeCard card={card} onResume={() => resume("phone")} onDismiss={() => dismiss("phone")} />
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <p className="font-serif text-6xl tracking-tight">{clock(now).slice(0, 5)}</p>
                    <p className="mt-2 text-sm text-ink/60">Snapback is watching for calls</p>
                  </div>
                )}
                <button onClick={ring} className="mt-3 w-full bg-ink px-4 py-3 text-sm font-bold text-paper">
                  Simulate incoming call
                </button>
              </div>
            )}

            {call.phase !== "idle" && (
              <div className="flex flex-1 flex-col items-center text-center">
                <p className="mt-8 text-xs tracking-[0.2em] uppercase opacity-70">{call.phase === "ringing" ? "Incoming call" : "On call"}</p>
                <div className={`mt-6 flex size-24 items-center justify-center rounded-full border border-paper/40 font-serif text-4xl ${call.phase === "ringing" ? "ringing" : ""}`}>P</div>
                <p className="mt-4 font-serif text-2xl">Priya</p>
                <p className="text-sm opacity-70">Team lead</p>
                {call.phase === "active" && (
                  <p data-testid="timer" className="mt-6 font-mono text-4xl tabular-nums">
                    {mmss(now - call.answeredAt)}
                  </p>
                )}
                <div className="mt-auto flex w-full gap-2">
                  {call.phase === "ringing" ? (
                    <>
                      <button onClick={() => dropCall("Call declined; no card shown")} className="flex-1 border border-paper/60 px-3 py-3 text-sm font-bold">
                        Decline
                      </button>
                      <button onClick={answer} className="flex-1 bg-accent px-3 py-3 text-sm font-bold text-white">
                        Answer
                      </button>
                    </>
                  ) : (
                    <button onClick={endCall} className="flex-1 bg-paper px-3 py-3 text-sm font-bold text-ink">
                      End call
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <ul className="mx-auto mt-4 max-w-[300px] list-disc space-y-1 pl-5 text-sm text-ink/70">
            <li>The snapshot is from just before the phone rang.</li>
            <li>Calls under {MIN_CALL_S} seconds show no card.</li>
            <li>Missed or declined calls show no card.</li>
          </ul>
        </section>

        <section aria-label="Activity log">
          <PanelTitle name="Activity log" hint="What each device did, newest first." />
          <ol aria-live="polite" className="h-52 overflow-y-auto border border-ink bg-white p-3 font-mono text-xs leading-relaxed">
            {log.length === 0 && <li className="text-ink/50">No events yet. Press &ldquo;Simulate incoming call&rdquo; on the phone.</li>}
            {log.map((e, i) => (
              <li key={log.length - i} className="flex gap-3">
                <time className="shrink-0 text-ink/50">{clock(e.t)}</time>
                <span className={`w-14 shrink-0 font-bold uppercase ${e.who === "phone" ? "text-accent" : ""}`}>{e.who}</span>
                <span>{e.msg}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-ink/60">
            The real system is a laptop daemon, a VS Code extension and an Android app on the same Wi-Fi. Here everything runs in this page and nothing leaves your browser.
          </p>
        </section>
      </main>
    </div>
  );
}

function PanelTitle({ name, hint }: { name: string; hint: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
      <h2 className="font-serif text-2xl">{name}</h2>
      <p className="text-sm text-ink/60">{hint}</p>
    </div>
  );
}

function ResumeCard({ card, onResume, onDismiss }: { card: Card; onResume: () => void; onDismiss: () => void }) {
  return (
    <div role="status" className="card-in border border-ink bg-paper p-3 text-left text-ink shadow-[4px_4px_0_0_var(--color-ink)]">
      <p className="text-[10px] font-bold tracking-[0.15em] text-accent uppercase">Snapback &middot; Resume card</p>
      <p className="mt-1.5 font-serif text-[17px] leading-snug">
        {card.headline}. <span className="italic">{card.next}.</span>
      </p>
      <p className="mt-1.5 font-mono text-[11px] text-ink/70">{card.facts}</p>
      <p className="mt-2 border border-dashed border-ink/40 px-2 py-1 text-[11px] text-ink/70">
        <b>AI summary (coming in Phase 6).</b> An on-device model will write this card. Today it is built from simple rules.
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={onResume} className="flex-1 bg-accent px-3 py-2 text-sm font-bold text-white">
          Resume
        </button>
        <button onClick={onDismiss} className="border border-ink px-3 py-2 text-sm">
          Dismiss
        </button>
      </div>
    </div>
  );
}
