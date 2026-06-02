"use client";

// /hermes — a text-chat surface for the Belong companion. It talks to the SAME
// grounded backend the voice agent uses (POST /api/ask -> ask_companion), so it
// knows the patient's profile, family roster, schedule, and memories. (It used
// to call a separate off-box Hermes upstream via /v1, which is why it didn't
// know "who am I" — that path is no longer used.)
import { useEffect, useRef } from "react";
import Link from "next/link";

// Auto-greeting on open: a hidden prompt asks the companion to greet, so the
// opening line reflects the persona + grounded context. STATIC_GREETING shows if
// the model is unreachable, so the screen is never blank or scary.
const GREETING_PROMPT =
  "The patient has just opened the chat. Greet them warmly in one or two short sentences to gently start the conversation.";
const STATIC_GREETING = "Hello, I'm Belong. I'm right here with you. How are you feeling today?";

type Turn = { role: "user" | "assistant"; content: string };

export default function HermesPage() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const $ = (id: string) => root.querySelector("#" + id) as HTMLElement | null;
    const log = $("hc-log")!;
    const text = $("hc-text") as HTMLTextAreaElement;
    const send = $("hc-send") as HTMLButtonElement;
    const status = $("hc-status")!;
    const model = $("hc-model")!;
    model.textContent = "belong companion";

    // Prior turns sent to ask_companion as `history` (same shape the voice page uses).
    const history: Turn[] = [];

    function addBubble(role: "user" | "bot" | "err", content: string) {
      const row = document.createElement("div");
      row.className = "hc-row " + role;
      const b = document.createElement("div");
      b.className = "hc-bubble" + (role === "err" ? " err" : "");
      b.textContent = content; // textContent => safe, no HTML injection
      row.appendChild(b);
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
      return b;
    }

    async function ping() {
      try {
        const r = await fetch("/api/health");
        status.classList.toggle("ok", r.ok);
      } catch {
        status.classList.remove("ok");
      }
    }
    ping();

    // One grounded reply from the backend companion. `record:false` keeps the
    // hidden greeting prompt out of the conversation history. Returns success.
    async function ask(userInput: string, opts: { fallback?: string; record?: boolean } = {}) {
      send.disabled = true;
      const bubble = addBubble("bot", "");
      const cursor = document.createElement("span");
      cursor.className = "hc-cursor";
      bubble.appendChild(cursor);
      try {
        const resp = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_input: userInput, history }),
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const reply = ((await resp.json()).reply || "").trim();
        cursor.remove();
        bubble.textContent = reply || "(no reply)";
        if (opts.record !== false) {
          history.push({ role: "user", content: userInput });
          history.push({ role: "assistant", content: reply });
        }
        return true;
      } catch (e) {
        cursor.remove();
        if (opts.fallback) {
          bubble.textContent = opts.fallback; // never show the patient a raw error
        } else {
          bubble.className = "hc-bubble err";
          bubble.textContent = "Sorry, I couldn't reach the companion just now. " + (e as Error).message;
        }
        return false;
      } finally {
        send.disabled = false;
        text.focus();
      }
    }

    async function sendMessage() {
      const content = text.value.trim();
      if (!content) return;
      text.value = "";
      autoGrow();
      addBubble("user", content);
      await ask(content, { record: true });
    }

    // Greet the patient on open (hidden prompt -> the first visible bubble is the
    // companion's warm hello, grounded in who they are).
    async function autoGreet() {
      await ask(GREETING_PROMPT, { fallback: STATIC_GREETING, record: false });
    }

    function autoGrow() {
      text.style.height = "auto";
      text.style.height = Math.min(text.scrollHeight, 160) + "px";
    }

    const onInput = () => autoGrow();
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };
    const onSend = () => sendMessage();

    text.addEventListener("input", onInput);
    text.addEventListener("keydown", onKeydown);
    send.addEventListener("click", onSend);

    if (!startedRef.current) {
      startedRef.current = true;
      autoGreet();
    }

    return () => {
      text.removeEventListener("input", onInput);
      text.removeEventListener("keydown", onKeydown);
      send.removeEventListener("click", onSend);
    };
  }, []);

  return (
    <main className="fixed inset-0 flex flex-col min-h-0 overflow-hidden">
      {/* All styles scoped under #hermes-chat so nothing leaks into the rest of the app. */}
      <style>{`
        #hermes-chat {
          --field: #ffffff; --panel: rgba(255,255,255,0.75); --bubble-user: #4aacaa; --bubble-bot: #ffffff;
          --text: #14302f; --muted: #5b6b6a; --border: #cfe6e4; --accent: #2c8f8d;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          color: var(--text);
          background: linear-gradient(to bottom, #4aacaa 0%, #ffffff 100%);
          display: flex; flex-direction: column; height: 100%; min-height: 0;
          box-sizing: border-box;
        }
        #hermes-chat * { box-sizing: border-box; }
        #hermes-chat .hc-header {
          padding: 12px 16px; border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 10px; font-weight: 600;
          flex-wrap: wrap;
        }
        #hermes-chat .hc-back {
          display: inline-flex; align-items: center; gap: 6px;
          color: var(--text); text-decoration: none; font-weight: 600; font-size: 15px;
          background: var(--bubble-bot); border: 1px solid var(--border);
          border-radius: 10px; padding: 8px 14px; min-height: 44px;
        }
        #hermes-chat .hc-back:hover { background: #e6f6f5; }
        #hermes-chat .hc-back:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        #hermes-chat .hc-title { font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
        #hermes-chat .hc-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
        #hermes-chat .hc-dot.ok { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
        #hermes-chat .hc-header small { color: var(--muted); font-weight: 400; margin-left: auto; flex-shrink: 0; }
        @media (max-width: 480px) {
          #hermes-chat .hc-header small { display: none; }
          #hermes-chat .hc-title { font-size: 16px; }
        }
        #hermes-chat .hc-log {
          flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px;
        }
        #hermes-chat .hc-row { display: flex; }
        #hermes-chat .hc-row.user { justify-content: flex-end; }
        #hermes-chat .hc-bubble {
          max-width: 78%; padding: 10px 13px; border-radius: 14px; line-height: 1.45;
          white-space: pre-wrap; word-wrap: break-word; background: var(--bubble-bot);
          border: 1px solid var(--border); box-shadow: 0 1px 2px rgba(20,48,47,0.06);
        }
        #hermes-chat .hc-row.user .hc-bubble { background: var(--bubble-user); color: #fff; border-color: var(--bubble-user); }
        #hermes-chat .hc-bubble.err { background: #fdecec; color: #b42318; border-color: #f3c0c0; }
        #hermes-chat .hc-cursor { display: inline-block; width: 7px; height: 1em; background: var(--accent);
          vertical-align: text-bottom; animation: hc-blink 1s steps(2) infinite; }
        @keyframes hc-blink { 0%,50% { opacity: 1 } 50.01%,100% { opacity: 0 } }
        #hermes-chat .hc-input {
          border-top: 1px solid var(--border); padding: 12px; display: flex; gap: 8px; background: var(--panel);
        }
        #hermes-chat textarea {
          flex: 1; resize: none; background: var(--field); color: var(--text);
          border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
          font: inherit; max-height: 160px; outline: none;
        }
        #hermes-chat textarea::placeholder { color: var(--muted); }
        #hermes-chat textarea:focus { border-color: var(--bubble-user); }
        #hermes-chat button {
          background: var(--bubble-user); color: #fff; border: 0; border-radius: 10px;
          padding: 0 18px; font: inherit; font-weight: 600; cursor: pointer;
        }
        #hermes-chat button:disabled { opacity: .5; cursor: default; }
      `}</style>

      <div id="hermes-chat" ref={rootRef}>
        <div className="hc-header">
          <Link href="/" className="hc-back" aria-label="Back to home">
            <span aria-hidden="true">←</span> Back
          </Link>
          <span className="hc-dot" id="hc-status" aria-hidden="true" />
          <span className="hc-title">Belong Text Companion</span>
          <small id="hc-model">belong companion</small>
        </div>
        <div className="hc-log" id="hc-log" />
        <div className="hc-input">
          <textarea id="hc-text" rows={1} placeholder="Message Belong…" />
          <button id="hc-send">Send</button>
        </div>
      </div>
    </main>
  );
}
