"use client";

// Hidden /hermes page — a self-contained chat client for the Hermes agent.
// Unlinked: nothing in the app navigates here, you reach it by typing the URL.
// It talks to "/v1" (same origin) which is proxied to Hermes by
// app/v1/[...path]/route.ts, so there is no CORS to deal with.
//
// All markup/logic is faithfully ported from hermes-agent/webchat/hermes-chat.html.
import { useEffect, useRef } from "react";
import Link from "next/link";

// ===================== CONFIG =====================
const BASE_URL = "/v1"; // proxied same-origin to Hermes (no CORS, no 403)
const MODEL = "hermes-agent";
const API_KEY = ""; // bearer token if you later enable auth on the gateway
const SYSTEM = ""; // optional system prompt prepended to every conversation
// Auto-greeting on open: a hidden prompt asks the LLM to greet, so the opening
// line reflects the Belong persona + injected memories/schedule. STATIC_GREETING
// is shown if the model is unreachable, so the screen is never blank or scary.
const GREETING_PROMPT =
  "The patient has just opened the chat. Greet them warmly in one or two short sentences to gently start the conversation.";
const STATIC_GREETING = "Hello, I'm Belong. I'm right here with you. How are you feeling today?";
// =================================================

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
    model.textContent = MODEL;

    type Turn = { role: "system" | "user" | "assistant"; content: string };
    const history: Turn[] = SYSTEM ? [{ role: "system", content: SYSTEM }] : [];

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

    function headers(): Record<string, string> {
      const h: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) h["Authorization"] = "Bearer " + API_KEY;
      return h;
    }

    async function ping() {
      try {
        const r = await fetch(BASE_URL + "/models", { headers: headers() });
        status.classList.toggle("ok", r.ok);
      } catch {
        status.classList.remove("ok");
      }
    }
    ping();

    // Stream one assistant reply for the current `history`. On error, shows
    // `fallback` as a normal bubble if given (used by the greeting), else an
    // error bubble. Returns whether it succeeded.
    async function streamAssistant(opts: { fallback?: string } = {}) {
      send.disabled = true;
      const bubble = addBubble("bot", "");
      const cursor = document.createElement("span");
      cursor.className = "hc-cursor";
      bubble.appendChild(cursor);

      let acc = "";
      try {
        const resp = await fetch(BASE_URL + "/chat/completions", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ model: MODEL, messages: history, stream: true }),
        });
        if (!resp.ok || !resp.body)
          throw new Error("HTTP " + resp.status + " " + (await resp.text()).slice(0, 300));

        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? ""; // keep partial line
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const payload = s.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
              if (delta) {
                acc += delta;
                bubble.textContent = acc;
                bubble.appendChild(cursor);
                log.scrollTop = log.scrollHeight;
              }
            } catch {
              /* ignore keep-alive / non-JSON lines */
            }
          }
        }
        cursor.remove();
        if (!acc) bubble.textContent = "(empty response)";
        history.push({ role: "assistant", content: acc });
        return true;
      } catch (e) {
        cursor.remove();
        if (opts.fallback) {
          bubble.textContent = opts.fallback; // never show the patient a raw error
          history.push({ role: "assistant", content: opts.fallback });
        } else {
          bubble.className = "hc-bubble err";
          bubble.textContent = "Error: " + (e as Error).message;
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
      history.push({ role: "user", content });
      const ok = await streamAssistant();
      if (!ok) history.pop(); // drop the user turn so retry is clean
    }

    // Greet the patient on open by prompting the LLM (hidden user turn, so the
    // first visible bubble is the assistant's warm hello).
    async function autoGreet() {
      history.push({ role: "user", content: GREETING_PROMPT });
      await streamAssistant({ fallback: STATIC_GREETING });
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

    // Open with a warm greeting (once).
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
    <main className="flex flex-col min-h-0 h-[100dvh]">
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
          <small id="hc-model">hermes-agent</small>
        </div>
        <div className="hc-log" id="hc-log" />
        <div className="hc-input">
          <textarea
            id="hc-text"
            rows={1}
            placeholder="Message Belong…  (Enter to send, Shift+Enter for newline)"
          />
          <button id="hc-send">Send</button>
        </div>
      </div>
    </main>
  );
}
