"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useSpeechRecognition } from "@/components/useSpeechRecognition";
import { CATEGORY_META } from "@/lib/categories";
import type { DetectedEntry } from "@/lib/schema";

type Stage = "idle" | "listening" | "classifying" | "reviewing" | "logging" | "done";

interface LogResult {
  entry: DetectedEntry;
  htmlLink?: string;
  error?: string;
}

export default function Home() {
  const { data: session, status } = useSession();
  const speech = useSpeechRecognition();

  const [stage, setStage] = useState<Stage>("idle");
  const [entries, setEntries] = useState<DetectedEntry[]>([]);
  const [results, setResults] = useState<LogResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resetAll = () => {
    setStage("idle");
    setEntries([]);
    setResults([]);
    setErrorMsg(null);
    speech.reset();
  };

  const handleMicTap = async () => {
    if (speech.isListening) {
      speech.stop();
      return;
    }
    resetAll();
    setStage("listening");
    speech.start();
  };

  // Once recognition ends, if we captured a transcript, classify it.
  const handleRecognitionEnded = async () => {
    if (!speech.transcript.trim()) {
      setErrorMsg("Didn't catch anything — try tapping the mic and speaking again.");
      setStage("idle");
      return;
    }
    setStage("classifying");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: speech.transcript }),
      });
      if (!res.ok) throw new Error(`Classify failed (${res.status})`);
      const data = await res.json();
      const detected: DetectedEntry[] = data.entries ?? [];
      setEntries(detected);
      if (detected.length === 0) {
        setErrorMsg(
          "Didn't detect any loggable moments in that. Try being a bit more specific."
        );
        setStage("idle");
      } else {
        setStage("reviewing");
      }
    } catch (err) {
      setErrorMsg("Something went wrong understanding that. Please try again.");
      setStage("idle");
    }
  };

  // React to speech recognition finishing (isListening flips false once
  // the browser decides the utterance is done).
  const stageRef = useRef(stage);
  stageRef.current = stage;
  useEffect(() => {
    if (!speech.isListening && stageRef.current === "listening") {
      handleRecognitionEnded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.isListening]);

  const handleConfirmLog = async () => {
    setStage("logging");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to log to calendar.");
        setStage("reviewing");
        return;
      }
      setResults(data.results ?? []);
      setStage("done");
    } catch {
      setErrorMsg("Failed to log to calendar. Please try again.");
      setStage("reviewing");
    }
  };

  if (status === "loading") {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main>
        <h1>🎙️ Voice Life-Logger</h1>
        <p className="muted">
          Speak a moment from your day — food, mood, meds, exercise, prayer, or
          expenses — and it lands on your Google Calendar automatically.
        </p>
        <button className="btn-primary" onClick={() => signIn("google")}>
          Sign in with Google
        </button>
      </main>
    );
  }

  return (
    <main>
      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 20 }}>🎙️ Voice Life-Logger</h1>
        <button className="btn-secondary" onClick={() => signOut()}>
          Sign out
        </button>
      </div>

      <button
        className={`mic-button ${speech.isListening ? "listening" : ""}`}
        onClick={handleMicTap}
        disabled={stage === "classifying" || stage === "logging"}
        aria-label={speech.isListening ? "Stop listening" : "Start speaking"}
      >
        {speech.isListening ? "■" : "🎤"}
      </button>

      <p className="muted">
        {stage === "idle" && "Tap the mic and describe a moment from your day."}
        {stage === "listening" && "Listening… tap again to stop."}
        {stage === "classifying" && "Understanding what you said…"}
        {stage === "reviewing" && "Here's what I detected — confirm to log it."}
        {stage === "logging" && "Logging to your calendar…"}
        {stage === "done" && "Logged! Tap the mic to log something else."}
      </p>

      {speech.transcript && stage !== "idle" && (
        <div className="card">
          <div className="transcript-box">“{speech.transcript}”</div>
        </div>
      )}

      {(speech.error || errorMsg) && (
        <p className="muted" style={{ color: "#b5322a" }}>
          {speech.error || errorMsg}
        </p>
      )}

      {stage === "reviewing" && entries.length > 0 && (
        <div className="card">
          {entries.map((entry, i) => (
            <EntryRow key={i} entry={entry} />
          ))}
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button className="btn-primary" onClick={handleConfirmLog}>
              Log {entries.length} {entries.length === 1 ? "entry" : "entries"} to Calendar
            </button>
            <button className="btn-secondary" onClick={resetAll}>
              Discard
            </button>
          </div>
        </div>
      )}

      {stage === "done" && results.length > 0 && (
        <div className="card">
          {results.map((r, i) => (
            <div key={i}>
              <div className="entry-row">
                <span className="entry-emoji">{CATEGORY_META[r.entry.category].emoji}</span>
                <div style={{ flex: 1 }}>
                  <div className="entry-title">{r.entry.title}</div>
                  <div className="entry-detail">{r.entry.detail}</div>
                </div>
                {r.htmlLink ? (
                  <a className="status-badge" href={r.htmlLink} target="_blank" rel="noreferrer">
                    View event
                  </a>
                ) : (
                  <span className="status-badge error">Failed</span>
                )}
              </div>
              {r.error && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#b5322a",
                    marginTop: -6,
                    marginBottom: 8,
                    wordBreak: "break-word",
                  }}
                >
                  {r.error}
                </div>
              )}
            </div>
          ))}
          <div style={{ marginTop: 16 }}>
            <button className="btn-secondary" onClick={resetAll}>
              Log another moment
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function EntryRow({ entry }: { entry: DetectedEntry }) {
  const meta = CATEGORY_META[entry.category];
  return (
    <div className="entry-row">
      <span className="entry-emoji">{meta.emoji}</span>
      <div>
        <div className="entry-title">{entry.title}</div>
        <div className="entry-detail">
          {meta.label} · {entry.detail}
        </div>
      </div>
    </div>
  );
}
