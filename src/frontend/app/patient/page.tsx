"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

// Family member avatar — shows the stored photo, falls back to their initial.
function FamilyAvatar({ id, name }: { id: string; name: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="w-16 h-16 shrink-0 rounded-full bg-zinc-700 flex items-center justify-center text-2xl font-semibold text-zinc-200">
        {name?.[0]?.toUpperCase() || "?"}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/people/${id}/photo`}
      alt={name}
      onError={() => setErr(true)}
      className="w-16 h-16 shrink-0 rounded-full object-cover border border-zinc-600"
    />
  );
}

// VAPID public key (base64url) -> Uint8Array for PushManager.subscribe.
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PatientPage() {
  const [status, setStatus] = useState<
    "idle" | "listening" | "thinking" | "speaking" | "camera"
  >("idle");
  const [subtitle, setSubtitle] = useState("I am here to help you.");
  const [lastHeard, setLastHeard] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Voice conversation state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Multi-turn history so the companion can actually follow the conversation.
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  // Patient's location (for "where is the nearest washroom / care home?").
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);
  const ensureLocation = () => {
    if (locationRef.current || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
      () => { /* denied/unavailable — the companion just won't know the location */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  };

  // Attach the camera stream once the <video> element is actually mounted.
  // The video is only rendered when status === "camera", so we cannot assign
  // srcObject inside startCamera (the element doesn't exist yet at that point).
  useEffect(() => {
    if (status === "camera" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [status]);

  // --- Memories overlay (reminiscence: read the life story aloud, by person) ---
  type Mem = { id: string; text: string };
  type PersonGroup = { id: string; name: string; relationship: string; memories: Mem[] };
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [people, setPeople] = useState<PersonGroup[]>([]);
  const [general, setGeneral] = useState<Mem[]>([]);

  const openMemories = async () => {
    try {
      const res = await fetch("/api/journal", { cache: "no-store" });
      const data = await res.json();
      setPeople((data.people || []).filter((p: PersonGroup) => p.memories.length > 0));
      setGeneral(data.general || []);
    } catch {
      setPeople([]);
      setGeneral([]);
    }
    setMemoriesOpen(true);
  };

  const speakText = async (text: string) => {
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: text }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (!audioRef.current) audioRef.current = new Audio(url);
      else audioRef.current.src = url;
      audioRef.current.play().catch(() => {});
    } catch {
      /* ignore */
    }
  };

  // --- Daily Briefing (a warm "good morning" summary of today) ---
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefing, setBriefing] = useState("");

  const openBriefing = async () => {
    let text = "Good morning.";
    try {
      const res = await fetch("/api/briefing", { cache: "no-store" });
      text = (await res.json()).briefing || text;
    } catch {
      /* keep the gentle default */
    }
    setBriefing(text);
    setBriefingOpen(true);
    speakText(text); // read it aloud, like About Me
  };

  // --- Mood check-in (how are you feeling today?) ---
  const MOODS = [
    { key: "great", emoji: "😊", label: "Great" },
    { key: "good", emoji: "🙂", label: "Good" },
    { key: "okay", emoji: "😐", label: "Okay" },
    { key: "low", emoji: "😟", label: "Low" },
    { key: "sad", emoji: "😢", label: "Sad" },
  ];
  const [moodOpen, setMoodOpen] = useState(false);
  const [moodLogged, setMoodLogged] = useState(false);

  const openMood = () => {
    setMoodLogged(false);
    setMoodOpen(true);
  };

  const logMood = async (mood: string) => {
    try {
      await fetch("/api/mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood }),
      });
    } catch {
      /* still acknowledge — the patient should never feel an error */
    }
    setMoodLogged(true);
    speakText("Thank you for sharing how you feel. I am right here with you.");
  };

  // --- Photo Journal (pictures with captions, tap to hear) ---
  const [photoJournalOpen, setPhotoJournalOpen] = useState(false);
  const [photoJournal, setPhotoJournal] = useState<{ id: string; caption: string }[]>([]);

  const openPhotoJournal = async () => {
    try {
      const res = await fetch("/api/photo-journal", { cache: "no-store" });
      setPhotoJournal((await res.json()).photos || []);
    } catch {
      setPhotoJournal([]);
    }
    setPhotoJournalOpen(true);
  };

  // --- About Me (who you are: name, photo, your story, your family) ---
  type Person = { id: string; name: string; relationship: string };
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profile, setProfile] = useState<{
    name?: string;
    tagline?: string;
    photo?: string;
    emergency_name?: string;
    emergency_phone?: string;
  }>({});
  const [aboutPeople, setAboutPeople] = useState<Person[]>([]);
  const [aboutGeneral, setAboutGeneral] = useState<Mem[]>([]);

  const openAbout = async () => {
    let prof: { name?: string; tagline?: string; photo?: string } = {};
    try {
      const [p, j] = await Promise.all([
        fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/journal", { cache: "no-store" }).then((r) => r.json()),
      ]);
      prof = p || {};
      setProfile(prof);
      setAboutPeople(j.people || []);
      setAboutGeneral(j.general || []);
    } catch {
      setProfile({});
      setAboutPeople([]);
      setAboutGeneral([]);
    }
    setAboutOpen(true);
    if (prof.name) speakText(`You are ${prof.name}.${prof.tagline ? " " + prof.tagline : ""}`);
  };

  // --- Reminders (medication / appointment / family push notifications) ---
  type Reminder = { title?: string; body?: string; type?: string };
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [remindersOn, setRemindersOn] = useState(false);

  const showReminder = useCallback((payload: Reminder) => {
    setReminder(payload);
    speakText(`${payload.title || "Reminder"}. ${payload.body || ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "anchor-reminder") showReminder(e.data.payload);
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    // Opened from a notification click (?reminder=...)
    const r = new URLSearchParams(window.location.search).get("reminder");
    if (r) {
      try { showReminder(JSON.parse(r)); } catch { /* ignore */ }
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      setRemindersOn(true);
    }
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [showReminder]);

  const enableReminders = async () => {
    try {
      if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
        alert("Notifications aren't supported on this device.");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        alert("Please allow notifications so you can get reminders.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { public_key } = await (await fetch("/api/push/public_key")).json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      setRemindersOn(true);
    } catch (e) {
      console.error("enable reminders failed", e);
      alert("Could not enable reminders.");
    }
  };

  // One big button drives the whole conversation. Tap to start listening, tap
  // again to stop — then we transcribe, ask the companion, and speak the reply.
  const handleTalk = async () => {
    if (status === "camera") stopCamera();
    if (status === "idle") {
      await startListening();
    } else if (status === "listening") {
      stopListening();
    } else if (status === "speaking") {
      // Barge-in: stop the companion and let the person speak again.
      audioRef.current?.pause();
      await startListening();
    }
    // "thinking" → ignore taps (button is disabled then anyway).
  };

  const startListening = async () => {
    try {
      ensureLocation(); // start fetching location while they speak
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        processTurn(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setLastHeard("");
      setStatus("listening");
      setSubtitle("I'm listening… tap when you're done.");
    } catch (err) {
      console.error("Mic access failed", err);
      setStatus("idle");
      setSubtitle("I couldn't hear the microphone. Please allow mic access.");
    }
  };

  const stopListening = () => {
    mediaRecorderRef.current?.stop();
  };

  const processTurn = async (blob: Blob) => {
    setStatus("thinking");
    setSubtitle("Let me think about that…");
    try {
      // 1. Speech → text (local Whisper)
      const form = new FormData();
      form.append("file", blob, "speech.webm");
      const sttRes = await fetch("/api/transcribe", { method: "POST", body: form });
      const { text } = await sttRes.json();
      const heard = (text || "").trim();
      if (!heard) {
        setStatus("idle");
        setSubtitle("I didn't quite catch that. Tap the button and try again.");
        return;
      }
      setLastHeard(heard);

      // 2. Text → companion reply (Nemotron, with conversation memory + RAG)
      const askRes = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: heard,
          history: historyRef.current,
          location: locationRef.current || undefined,
        }),
      });
      const { reply } = await askRes.json();
      const answer = reply || "I'm right here with you.";
      historyRef.current.push({ role: "user", content: heard });
      historyRef.current.push({ role: "assistant", content: answer });

      // 3. Reply text → warm voice (local Piper)
      setStatus("speaking");
      setSubtitle(answer);
      const ttsRes = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: answer }),
      });
      const audioBlob = await ttsRes.blob();
      const url = URL.createObjectURL(audioBlob);
      if (!audioRef.current) audioRef.current = new Audio(url);
      else audioRef.current.src = url;
      audioRef.current.onended = () => {
        setStatus("idle");
        setSubtitle("Tap the button whenever you'd like to keep talking.");
      };
      await audioRef.current.play().catch(() => {
        // Autoplay blocked — leave the text on screen and return to idle.
        setStatus("idle");
        setSubtitle(answer);
      });
    } catch (e) {
      console.error("Conversation error", e);
      setStatus("idle");
      setSubtitle("My connection is resting right now. Let's try again in a moment.");
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      // The effect above attaches the stream to the <video> once it mounts.
      setStatus("camera");
      setSubtitle("Point the camera at them.");
    } catch (err) {
      console.error("Camera access denied or unavailable", err);
      setSubtitle("Camera is not available.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStatus("idle");
  };

  const handleIdentify = async () => {
    if (status !== "camera") {
      startCamera();
      return;
    }

    // Capture Frame to Canvas
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL("image/jpeg").split(',')[1];
    
    setSubtitle("Looking...");
    
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: base64Image })
      });
      const data = await res.json();

      const reply = data.match
        ? `This is ${data.name}, your ${data.relationship}.${data.fact ? " " + data.fact : ""}`
        : (data.message || "I don't recognize this person yet.");

      setSubtitle(reply);
      stopCamera();
      
      // Auto-play TTS for the face identification
      const audioRes = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: reply })
      });
      const blob = await audioRes.blob();
      const url = URL.createObjectURL(blob);
      if (!audioRef.current) audioRef.current = new Audio(url);
      else audioRef.current.src = url;
      audioRef.current.play();

    } catch (e) {
      setSubtitle("I couldn't look right now.");
      stopCamera();
    }
  };

  return (
    <main className="flex flex-col items-center w-full min-h-[100dvh] bg-[linear-gradient(to_bottom,#15605e_0%,#000000_60%)] text-white px-4 pt-20 pb-6 font-sans select-none relative overflow-y-auto justify-center gap-3">
      <style>{`
        @media (max-height: 700px) {
          .talk-btn-idle { height: 12rem !important; width: 12rem !important; }
          .talk-btn-listening { height: 14rem !important; width: 14rem !important; }
          .talk-btn-other { height: 12rem !important; width: 12rem !important; }
          .secondary-actions { margin-top: 2rem !important; }
        }
      `}</style>
      
      {/* Subtle Home Button in Top Left */}
      <Link href="/" className="absolute top-6 left-6 p-3 text-zinc-600 hover:text-zinc-300 transition-colors bg-zinc-900/50 hover:bg-zinc-800 rounded-full" title="Back to Home">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </Link>

      {/* Enable reminders (top right) */}
      <button
        onClick={enableReminders}
        className="absolute top-6 right-6 px-3 py-3 text-sm text-zinc-400 hover:text-zinc-100 bg-zinc-900/50 hover:bg-zinc-800 rounded-full transition-colors"
        title="Enable medication & event reminders"
      >
        <span className="hidden sm:inline">{remindersOn ? "🔔 Reminders on" : "🔕 Turn on reminders"}</span>
        <span className="sm:hidden">{remindersOn ? "🔔" : "🔕"}</span>
      </button>

      {/* Full-screen reminder card (medication / appointment / family / waste_pickup) */}
      {reminder && (
        <div className="absolute inset-0 z-30 bg-black/95 flex flex-col items-center justify-center p-8 text-center">
          <div className="text-8xl mb-6">
            {reminder.type === "medication" ? "💊"
              : reminder.type === "appointment" ? "📅"
              : reminder.type === "activity" ? "🎟️"
              : reminder.type === "family" ? "👪"
              : reminder.type === "waste_pickup" ? "♻️"
              : "🔔"}
          </div>
          <h2 className="text-5xl md:text-6xl font-semibold text-white mb-4 max-w-3xl leading-tight">
            {reminder.title}
          </h2>
          {reminder.body && (
            <p className="text-3xl text-zinc-300 mb-12 max-w-2xl">{reminder.body}</p>
          )}
          <button
            onClick={() => setReminder(null)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-3xl font-bold rounded-full px-16 py-8 shadow-2xl active:scale-95 transition-transform"
          >
            {reminder.type === "medication" ? "✓ I took it"
              : reminder.type === "waste_pickup" ? "✓ I'll put the bins out"
              : "✓ Okay"}
          </button>
        </div>
      )}

      {/* Dynamic Header */}
      <h1 className="text-3xl md:text-5xl font-medium text-center text-zinc-300 max-w-2xl px-2 min-h-[3.5rem]">
        {subtitle}
      </h1>

      {/* What we just heard the patient say (gentle feedback) */}
      <p className="text-lg md:text-xl text-zinc-500 italic text-center mb-6 max-w-xl px-4 min-h-[2rem]">
        {lastHeard && `You said: “${lastHeard}”`}
      </p>

      {/* Camera View Overlay */}
      {status === "camera" && (
        <div className="relative w-full max-w-sm rounded-[3rem] overflow-hidden shadow-2xl border-4 border-zinc-700 bg-zinc-900 mb-8 aspect-[3/4]">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover"
          />
          {/* Subtle targeting box */}
          <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-white/30 m-8 rounded-xl" />
        </div>
      )}
      
      {/* Massive Glowing Talk Button */}
      {status !== "camera" && (
        <button
          onClick={handleTalk}
          disabled={status === "thinking"}
          className={`relative rounded-full transition-all duration-300 flex items-center justify-center shadow-2xl
            ${status === "idle" ? "talk-btn-idle bg-amber-600 hover:bg-amber-500 hover:scale-105 active:scale-95 h-64 w-64 md:h-80 md:w-80" : ""}
            ${status === "listening" ? "talk-btn-listening bg-red-600 animate-pulse h-72 w-72 md:h-96 md:w-96" : ""}
            ${status === "thinking" ? "talk-btn-other bg-zinc-600 animate-pulse h-64 w-64 md:h-80 md:w-80" : ""}
            ${status === "speaking" ? "talk-btn-other bg-emerald-600 animate-pulse h-64 w-64 md:h-80 md:w-80 shadow-[0_0_80px_rgba(5,150,105,0.6)]" : ""}
          `}
        >
          <span className="text-3xl md:text-4xl font-bold tracking-wide px-4 text-center leading-tight">
            {status === "idle" && "TALK"}
            {status === "listening" && "TAP TO STOP"}
            {status === "thinking" && "THINKING…"}
            {status === "speaking" && "SPEAKING"}
          </span>
        </button>
      )}

      {/* Secondary Actions Row */}
      <div className="secondary-actions grid grid-cols-3 gap-2 sm:gap-3 mt-4 w-full max-w-md sm:max-w-2xl">
        <button
          onClick={openAbout}
          className="bg-zinc-800 hover:bg-zinc-700 rounded-2xl py-4 px-1 text-base sm:text-xl font-medium leading-tight text-center transition-transform active:scale-95 border border-zinc-700 min-h-[5rem] flex items-center justify-center"
        >
          👤 About Me
        </button>
        <button
          onClick={handleIdentify}
          className="bg-zinc-800 hover:bg-zinc-700 rounded-2xl py-4 px-1 text-base sm:text-xl font-medium leading-tight text-center transition-transform active:scale-95 border border-zinc-700 min-h-[5rem] flex items-center justify-center"
        >
          {status === "camera" ? "👁️ Identify Face" : "📷 Who is this?"}
        </button>
        <button
          onClick={openMemories}
          className="bg-zinc-800 hover:bg-zinc-700 rounded-2xl py-4 px-1 text-base sm:text-xl font-medium leading-tight text-center transition-transform active:scale-95 border border-zinc-700 min-h-[5rem] flex items-center justify-center"
        >
          📖 Memories
        </button>
        <button
          onClick={openBriefing}
          className="bg-zinc-800 hover:bg-zinc-700 rounded-2xl py-4 px-1 text-base sm:text-xl font-medium leading-tight text-center transition-transform active:scale-95 border border-zinc-700 min-h-[5rem] flex items-center justify-center"
        >
          🌅 Good Morning
        </button>
        <button
          onClick={openMood}
          className="bg-zinc-800 hover:bg-zinc-700 rounded-2xl py-4 px-1 text-base sm:text-xl font-medium leading-tight text-center transition-transform active:scale-95 border border-zinc-700 min-h-[5rem] flex items-center justify-center"
        >
          🙂 How I Feel
        </button>
        <button
          onClick={openPhotoJournal}
          className="bg-zinc-800 hover:bg-zinc-700 rounded-2xl py-4 px-1 text-base sm:text-xl font-medium leading-tight text-center transition-transform active:scale-95 border border-zinc-700 min-h-[5rem] flex items-center justify-center"
        >
          📷 Photo Journal
        </button>
      </div>

      {/* Photo Journal overlay — pictures with captions, tap to hear */}
      {photoJournalOpen && (
        <div className="absolute inset-0 z-20 bg-black/95 flex flex-col p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-8 max-w-3xl mx-auto w-full">
            <h2 className="text-3xl md:text-4xl font-medium text-zinc-200">Photo Journal</h2>
            <button
              onClick={() => setPhotoJournalOpen(false)}
              className="text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-full px-6 py-3 text-xl"
            >
              Close
            </button>
          </div>
          <div className="max-w-3xl mx-auto w-full">
            {photoJournal.length === 0 ? (
              <p className="text-zinc-400 text-center text-xl mt-12">
                No photo memories yet. Ask your family to add some.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pb-10">
                {photoJournal.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => speakText(p.caption)}
                    className="text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-2xl overflow-hidden transition-colors"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/memories/${p.id}/photo`}
                      alt={p.caption}
                      className="w-full h-56 object-cover"
                    />
                    <div className="p-5 text-2xl text-zinc-100 leading-relaxed">
                      {p.caption}
                      <span className="block text-zinc-500 text-base mt-2">🔊 Tap to hear this</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mood check-in overlay — tap how you feel */}
      {moodOpen && (
        <div className="absolute inset-0 z-30 bg-black/95 flex flex-col items-center justify-center p-8 text-center">
          {!moodLogged ? (
            <>
              <h2 className="text-4xl md:text-5xl font-semibold text-white mb-12">
                How are you feeling?
              </h2>
              <div className="flex flex-wrap gap-6 justify-center max-w-3xl">
                {MOODS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => logMood(m.key)}
                    className="flex flex-col items-center gap-2 bg-zinc-800 hover:bg-zinc-700 rounded-3xl px-8 py-6 active:scale-95 transition-transform border border-zinc-700"
                  >
                    <span className="text-6xl">{m.emoji}</span>
                    <span className="text-2xl font-medium">{m.label}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setMoodOpen(false)}
                className="mt-12 text-xl text-zinc-400 hover:text-white"
              >
                Close
              </button>
            </>
          ) : (
            <>
              <div className="text-8xl mb-6">💚</div>
              <h2 className="text-4xl md:text-5xl font-semibold text-white mb-12 max-w-2xl">
                Thank you for sharing.
              </h2>
              <button
                onClick={() => setMoodOpen(false)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-3xl font-bold rounded-full px-16 py-8 shadow-2xl active:scale-95 transition-transform"
              >
                ✓ Done
              </button>
            </>
          )}
        </div>
      )}

      {/* Daily Briefing overlay — a warm summary of today */}
      {briefingOpen && (
        <div className="absolute inset-0 z-20 bg-black/95 flex flex-col p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-8 max-w-2xl mx-auto w-full">
            <h2 className="text-3xl md:text-4xl font-medium text-zinc-200">Your Daily Briefing</h2>
            <button
              onClick={() => setBriefingOpen(false)}
              className="text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-full px-6 py-3 text-xl"
            >
              Close
            </button>
          </div>
          <div className="max-w-2xl mx-auto w-full space-y-8 pb-10">
            <p className="text-2xl md:text-3xl text-zinc-100 leading-relaxed whitespace-pre-line">
              {briefing}
            </p>
            <button
              onClick={() => speakText(briefing)}
              className="w-full bg-emerald-700 hover:bg-emerald-600 rounded-2xl py-6 text-2xl font-medium text-white transition-colors"
            >
              🔊 Read it again
            </button>
          </div>
        </div>
      )}

      {/* About Me overlay — who you are */}
      {aboutOpen && (
        <div className="absolute inset-0 z-20 bg-black/95 flex flex-col p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-6 max-w-2xl mx-auto w-full">
            <h2 className="text-3xl md:text-4xl font-medium text-zinc-200">About You</h2>
            <button
              onClick={() => setAboutOpen(false)}
              className="text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-full px-6 py-3 text-xl"
            >
              Close
            </button>
          </div>
          <div className="max-w-2xl mx-auto w-full space-y-8 pb-10">
            <div className="text-center">
              {profile.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.photo}
                  alt="You"
                  className="w-44 h-44 rounded-full object-cover mx-auto border-4 border-zinc-700 mb-5"
                />
              )}
              <p className="text-zinc-400 text-xl">This is you</p>
              <h3 className="text-5xl md:text-6xl font-semibold text-white mt-1">
                {profile.name || "You"}
              </h3>
              {profile.tagline && (
                <p className="text-2xl text-zinc-300 mt-3">{profile.tagline}</p>
              )}
            </div>

            {aboutGeneral.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-2xl font-semibold text-amber-300">A little about you</h4>
                {aboutGeneral.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => speakText(m.text)}
                    className="w-full text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-2xl p-6 text-2xl text-zinc-100 leading-relaxed transition-colors"
                  >
                    {m.text}
                    <span className="block text-zinc-500 text-base mt-3">🔊 Tap to hear this</span>
                  </button>
                ))}
              </div>
            )}

            {(profile.emergency_name || profile.emergency_phone) && (
              <div className="space-y-3">
                <h4 className="text-2xl font-semibold text-amber-300">If you need help</h4>
                <a
                  href={profile.emergency_phone ? `tel:${profile.emergency_phone}` : undefined}
                  className="block bg-red-900/40 hover:bg-red-900/60 border border-red-700 rounded-2xl p-6 text-2xl text-zinc-100 transition-colors"
                >
                  📞 Call {profile.emergency_name || "your contact"}
                  {profile.emergency_phone && (
                    <span className="block text-zinc-300 text-xl mt-1">{profile.emergency_phone}</span>
                  )}
                </a>
              </div>
            )}

            {aboutPeople.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-2xl font-semibold text-amber-300">Your family</h4>
                {aboutPeople.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => speakText(`This is ${p.name}, your ${p.relationship}.`)}
                    className="w-full text-left flex items-center gap-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-2xl p-5 transition-colors"
                  >
                    <FamilyAvatar id={p.id} name={p.name} />
                    <span>
                      <span className="text-2xl text-zinc-100">
                        {p.name} <span className="text-zinc-400">— your {p.relationship}</span>
                      </span>
                      <span className="block text-zinc-500 text-base mt-1">🔊 Tap to hear this</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Memories overlay — tap any memory to hear it read aloud */}
      {memoriesOpen && (
        <div className="absolute inset-0 z-20 bg-black/95 flex flex-col p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-8 max-w-2xl mx-auto w-full">
            <h2 className="text-3xl md:text-4xl font-medium text-zinc-200">Your Memories</h2>
            <button
              onClick={() => setMemoriesOpen(false)}
              className="text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-full px-6 py-3 text-xl"
            >
              Close
            </button>
          </div>
          <div className="max-w-2xl mx-auto w-full space-y-8 pb-10">
            {people.length === 0 && general.length === 0 && (
              <p className="text-zinc-400 text-center text-xl mt-12">
                No memories yet. Ask your family to add some.
              </p>
            )}

            {people.map((p) => (
              <div key={p.id} className="space-y-3">
                <h3 className="text-2xl font-semibold text-amber-300">
                  {p.name} <span className="text-zinc-500 text-xl font-normal">— your {p.relationship}</span>
                </h3>
                {p.memories.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => speakText(`${p.name}, your ${p.relationship}. ${m.text}`)}
                    className="w-full text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-2xl p-6 text-2xl text-zinc-100 leading-relaxed transition-colors"
                  >
                    {m.text}
                    <span className="block text-zinc-500 text-base mt-3">🔊 Tap to hear this</span>
                  </button>
                ))}
              </div>
            ))}

            {general.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-2xl font-semibold text-zinc-300">About you</h3>
                {general.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => speakText(m.text)}
                    className="w-full text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-2xl p-6 text-2xl text-zinc-100 leading-relaxed transition-colors"
                  >
                    {m.text}
                    <span className="block text-zinc-500 text-base mt-3">🔊 Tap to hear this</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </main>
  );
}
