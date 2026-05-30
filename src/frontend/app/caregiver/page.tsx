"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Mem = { id: string; text: string };
type Person = {
  id: string;
  name: string;
  relationship: string;
  has_photo: boolean;
  memory_count: number;
  memories: Mem[];
};
type EventItem = {
  id: string;
  type: "medication" | "appointment" | "family";
  title: string;
  notes?: string;
  time: string;
  date?: string;
  recurrence: "daily" | "once";
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CaregiverPage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "family" | "notes" | "calendar">("dashboard");

  // Family members
  const [people, setPeople] = useState<Person[]>([]);
  const [general, setGeneral] = useState<Mem[]>([]);

  // Calendar events
  const [events, setEvents] = useState<EventItem[]>([]);
  const [evType, setEvType] = useState<"medication" | "appointment" | "family">("medication");
  const [evTitle, setEvTitle] = useState("");
  const [evNotes, setEvNotes] = useState("");
  const [evTime, setEvTime] = useState("16:00");
  const [evDate, setEvDate] = useState("");
  const [evStatus, setEvStatus] = useState("");

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      setEvents(data.events || []);
    } catch {
      /* offline */
    }
  }, []);

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evTitle.trim()) {
      setEvStatus("⚠️ Please enter a title.");
      return;
    }
    const recurrence = evType === "medication" ? "daily" : "once";
    if (recurrence === "once" && !evDate) {
      setEvStatus("⚠️ Please pick a date for this event.");
      return;
    }
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: evType,
        title: evTitle,
        notes: evNotes,
        time: evTime,
        date: recurrence === "once" ? evDate : "",
        recurrence,
      }),
    });
    setEvStatus(`✅ Saved. ${recurrence === "daily" ? `Reminds every day at ${evTime}.` : `Reminds on ${evDate} at ${evTime}.`}`);
    setEvTitle("");
    setEvNotes("");
    await loadEvents();
  };

  const deleteEvent = async (id: string) => {
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    await loadEvents();
  };

  const sendTestReminder = async () => {
    const res = await fetch("/api/push/test", { method: "POST" });
    const data = await res.json();
    setEvStatus(data.sent > 0
      ? `🔔 Test reminder sent to ${data.sent} device(s).`
      : "No devices subscribed yet — open the Patient screen and tap 'Turn on reminders' first.");
  };

  // Add-person form
  const [pName, setPName] = useState("");
  const [pRel, setPRel] = useState("");
  const [pPhoto, setPPhoto] = useState("");
  const [pStatus, setPStatus] = useState("");
  const [pSaving, setPSaving] = useState(false);

  // Per-person expand + add-fact
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [factText, setFactText] = useState("");

  // General patient notes
  const [noteText, setNoteText] = useState("");
  const [noteStatus, setNoteStatus] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/journal");
      const data = await res.json();
      setPeople(data.people || []);
      setGeneral(data.general || []);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    if (activeTab === "family" || activeTab === "notes") load();
    if (activeTab === "calendar") loadEvents();
  }, [activeTab, load, loadEvents]);

  // ---- Family member actions ----
  const handleAddPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim() || !pRel.trim()) {
      setPStatus("⚠️ Please enter a name and a relationship.");
      return;
    }
    setPSaving(true);
    setPStatus(pPhoto ? "Saving & extracting face on-device…" : "Saving…");
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pName, relationship: pRel, image_base64: pPhoto || undefined }),
      });
      const data = await res.json();
      if (data.status === "success") {
        setPStatus(`✅ ${data.name} added${data.has_photo ? " with a photo" : ""}.`);
      } else if (data.status === "no_face") {
        setPStatus(`⚠️ ${data.message}`);
      } else {
        setPStatus(`❌ Failed (HTTP ${res.status}).`);
      }
      setPName("");
      setPRel("");
      setPPhoto("");
      await load();
    } catch {
      setPStatus("❌ Backend is offline. Is FastAPI running?");
    } finally {
      setPSaving(false);
    }
  };

  const handleAddFact = async (personId: string) => {
    if (!factText.trim()) return;
    await fetch(`/api/people/${personId}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: factText }),
    });
    setFactText("");
    await load();
  };

  const handleDeletePerson = async (personId: string) => {
    await fetch(`/api/people/${personId}`, { method: "DELETE" });
    if (expandedId === personId) setExpandedId(null);
    await load();
  };

  const handleDeleteFact = async (memId: string) => {
    await fetch(`/api/memories/${memId}`, { method: "DELETE" });
    await load();
  };

  const handleAddPhotoToPerson = async (personId: string, file: File) => {
    const base64 = await fileToBase64(file);
    const res = await fetch(`/api/people/${personId}/photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: base64 }),
    });
    const data = await res.json();
    if (data.status === "no_face") alert(data.message);
    await load();
  };

  // ---- General patient notes ----
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteStatus("Saving…");
    try {
      const res = await fetch("/api/enroll_memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: noteText, tags: "general" }),
      });
      if (res.ok) {
        setNoteText("");
        setNoteStatus("✅ Saved to the offline vault.");
        setTimeout(() => setNoteStatus(""), 2500);
        await load();
      } else {
        setNoteStatus("❌ Failed to save.");
      }
    } catch {
      setNoteStatus("❌ Backend offline.");
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 pb-12">
      {/* Header */}
      <header className="bg-zinc-900 text-white p-6 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 p-2 rounded-lg transition-colors" title="Back to Home">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Belong Caregiver UI</h1>
              <p className="text-zinc-400 text-sm mt-1">100% On-Device Family Portal</p>
            </div>
          </div>
          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Secure Offline Mode
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto mt-8 px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Sidebar */}
        <aside className="md:col-span-1 flex flex-col gap-2">
          {([
            ["dashboard", "📊 Daily Dashboard"],
            ["family", "👪 Family Members"],
            ["calendar", "🗓️ Calendar"],
            ["notes", "📖 Patient Notes"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === key ? "bg-zinc-900 text-white shadow-md" : "hover:bg-zinc-200 text-zinc-600"}`}
            >
              {label}
            </button>
          ))}
        </aside>

        {/* Content */}
        <section className="md:col-span-3">
          {/* DASHBOARD */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              <h2 className="text-3xl font-semibold tracking-tight border-b pb-4">Today's Summary</h2>
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-lg">AI Generated Rollup</h3>
                  <span className="text-xs text-zinc-500">4:30 PM Update</span>
                </div>
                <p className="text-zinc-600 leading-relaxed">
                  Helen had a calm morning. She asked where the dog was a few times between 3 PM and 4 PM. We looked at the memory journal at 4:30 PM, which improved her mood. She is currently resting.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 shadow-sm">
                  <div className="text-emerald-800 font-medium mb-1">Morning Mood</div>
                  <div className="text-3xl">😊 Good</div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 shadow-sm">
                  <div className="text-amber-800 font-medium mb-1">Afternoon Mood</div>
                  <div className="text-3xl">😐 OK</div>
                </div>
              </div>
            </div>
          )}

          {/* FAMILY MEMBERS */}
          {activeTab === "family" && (
            <div className="space-y-6">
              <h2 className="text-3xl font-semibold tracking-tight border-b pb-4">Family Members</h2>

              {/* Add a member */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-2">Add a Family Member</h3>
                <p className="text-zinc-500 text-sm mb-6">
                  Name &amp; relationship are required. A photo is optional — add one to enable &ldquo;Who is this?&rdquo; face recognition. The photo itself is discarded; only a private embedding is stored.
                </p>
                <form onSubmit={handleAddPerson} className="space-y-4 max-w-md">
                  <input
                    type="text"
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                    placeholder="Name — e.g. Sarah"
                  />
                  <input
                    type="text"
                    value={pRel}
                    onChange={(e) => setPRel(e.target.value)}
                    className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                    placeholder="Relationship — e.g. Daughter"
                  />
                  <div>
                    <label className="block text-sm font-medium mb-1 text-zinc-600">Photo (optional)</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        setPPhoto(f ? await fileToBase64(f) : "");
                      }}
                      className="w-full border rounded-lg px-4 py-2 bg-zinc-50 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-900 file:text-white"
                    />
                  </div>
                  <button type="submit" disabled={pSaving} className="w-full bg-zinc-900 text-white font-medium py-3 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-60">
                    {pSaving ? "Saving…" : "Add Family Member"}
                  </button>
                  {pStatus && <p className="text-sm font-medium text-zinc-700">{pStatus}</p>}
                </form>
              </div>

              {/* People list */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-4">Family ({people.length})</h3>
                {people.length === 0 ? (
                  <p className="text-zinc-400 text-sm">No family members yet. Add one above.</p>
                ) : (
                  <ul className="space-y-3">
                    {people.map((p) => (
                      <li key={p.id} className="border rounded-xl">
                        <div className="flex items-center justify-between p-4">
                          <button
                            onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                            className="text-left flex-1"
                          >
                            <span className="font-medium text-lg">{p.name}</span>
                            <span className="text-zinc-500"> — {p.relationship}</span>
                            <span className="ml-3 text-xs text-zinc-400">
                              {p.has_photo ? "📷 photo" : "no photo"} · {p.memory_count} {p.memory_count === 1 ? "fact" : "facts"}
                            </span>
                          </button>
                          <div className="flex items-center gap-3">
                            <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)} className="text-zinc-500 hover:text-zinc-900 text-sm">
                              {expandedId === p.id ? "Hide" : "Open"}
                            </button>
                            <button onClick={() => handleDeletePerson(p.id)} className="text-zinc-400 hover:text-red-600" title="Remove person">✕</button>
                          </div>
                        </div>

                        {expandedId === p.id && (
                          <div className="border-t p-4 bg-zinc-50/50 space-y-4">
                            {/* Their facts */}
                            {p.memories.length === 0 ? (
                              <p className="text-zinc-400 text-sm">No facts about {p.name} yet.</p>
                            ) : (
                              <ul className="space-y-2">
                                {p.memories.map((m) => (
                                  <li key={m.id} className="flex items-start justify-between gap-3 bg-white border rounded-lg px-3 py-2">
                                    <span className="text-sm text-zinc-700">{m.text}</span>
                                    <button onClick={() => handleDeleteFact(m.id)} className="text-zinc-400 hover:text-red-600 text-sm shrink-0" title="Remove fact">✕</button>
                                  </li>
                                ))}
                              </ul>
                            )}

                            {/* Add a fact about this person */}
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={expandedId === p.id ? factText : ""}
                                onChange={(e) => setFactText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddFact(p.id); } }}
                                placeholder={`Add a fact about ${p.name}…`}
                                className="flex-1 border rounded-lg px-3 py-2 bg-white focus:ring-2 outline-none text-sm"
                              />
                              <button onClick={() => handleAddFact(p.id)} className="bg-zinc-900 text-white text-sm font-medium px-4 rounded-lg hover:bg-zinc-800">Add</button>
                            </div>

                            {/* Add a photo if they don't have one */}
                            {!p.has_photo && (
                              <label className="block text-sm text-zinc-600">
                                Add a photo to enable face recognition:
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAddPhotoToPerson(p.id, f); }}
                                  className="mt-1 block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-zinc-200"
                                />
                              </label>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* CALENDAR / EVENTS */}
          {activeTab === "calendar" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <h2 className="text-3xl font-semibold tracking-tight">Calendar &amp; Reminders</h2>
                <button onClick={sendTestReminder} className="text-sm bg-zinc-200 hover:bg-zinc-300 rounded-lg px-3 py-2 font-medium">
                  🔔 Send test reminder
                </button>
              </div>

              {/* Add event */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-2">Add an Event</h3>
                <p className="text-zinc-500 text-sm mb-6">
                  Medications repeat <b>every day</b> at the set time. Appointments &amp; family events happen <b>once</b> on a date. The patient&apos;s tablet gets a push notification at the time.
                </p>
                <form onSubmit={handleAddEvent} className="space-y-4 max-w-md">
                  <div className="flex gap-2">
                    {(["medication", "appointment", "family"] as const).map((t) => (
                      <button
                        type="button"
                        key={t}
                        onClick={() => setEvType(t)}
                        className={`flex-1 capitalize rounded-lg py-2 text-sm font-medium border ${evType === t ? "bg-zinc-900 text-white" : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100"}`}
                      >
                        {t === "medication" ? "💊 Medication" : t === "appointment" ? "📅 Appointment" : "👪 Family"}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={evTitle}
                    onChange={(e) => setEvTitle(e.target.value)}
                    className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                    placeholder={evType === "medication" ? "Medicine name — e.g. Heart Pill" : "Title — e.g. Dr. Lee / Sarah visits"}
                  />
                  <input
                    type="text"
                    value={evNotes}
                    onChange={(e) => setEvNotes(e.target.value)}
                    className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                    placeholder={evType === "medication" ? "Note — e.g. Take 1 tablet with water" : "Note (optional)"}
                  />
                  <div className="flex gap-3">
                    <label className="flex-1 text-sm text-zinc-600">
                      Time
                      <input type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 bg-zinc-50" />
                    </label>
                    {evType !== "medication" && (
                      <label className="flex-1 text-sm text-zinc-600">
                        Date
                        <input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 bg-zinc-50" />
                      </label>
                    )}
                  </div>
                  <button type="submit" className="w-full bg-zinc-900 text-white font-medium py-3 rounded-lg hover:bg-zinc-800 transition-colors">
                    Add to Calendar
                  </button>
                  {evStatus && <p className="text-sm font-medium text-zinc-700">{evStatus}</p>}
                </form>
              </div>

              {/* Event list */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-4">Scheduled ({events.length})</h3>
                {events.length === 0 ? (
                  <p className="text-zinc-400 text-sm">Nothing scheduled yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {events.map((ev) => (
                      <li key={ev.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
                        <div>
                          <span className="font-medium">
                            {ev.type === "medication" ? "💊" : ev.type === "appointment" ? "📅" : "👪"} {ev.title}
                          </span>
                          <span className="text-zinc-500 text-sm ml-2">
                            {ev.recurrence === "daily" ? `every day at ${ev.time}` : `${ev.date} at ${ev.time}`}
                          </span>
                          {ev.notes && <div className="text-zinc-400 text-xs mt-0.5">{ev.notes}</div>}
                        </div>
                        <button onClick={() => deleteEvent(ev.id)} className="text-zinc-400 hover:text-red-600" title="Remove">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* PATIENT NOTES (general) */}
          {activeTab === "notes" && (
            <div className="space-y-6">
              <h2 className="text-3xl font-semibold tracking-tight border-b pb-4">Patient Notes</h2>
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-2">General facts about the patient</h3>
                <p className="text-zinc-500 text-sm mb-6">
                  Facts about the patient themselves (not a specific person) — where they grew up, hobbies, routines. The Companion uses these automatically in conversation.
                </p>
                <form onSubmit={handleAddNote} className="space-y-4">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    className="w-full border rounded-lg px-4 py-3 bg-zinc-50 focus:ring-2 outline-none min-h-[100px]"
                    placeholder="e.g., Helen grew up in Scarborough. She loves gardening and Earl Grey tea."
                  />
                  <div className="flex items-center gap-4">
                    <button type="submit" className="bg-zinc-900 text-white font-medium px-6 py-3 rounded-lg hover:bg-zinc-800 transition-colors">Save Note</button>
                    {noteStatus && <span className="text-sm font-medium text-emerald-600">{noteStatus}</span>}
                  </div>
                </form>
              </div>

              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-4">Saved Notes ({general.length})</h3>
                {general.length === 0 ? (
                  <p className="text-zinc-400 text-sm">No general notes yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {general.map((m) => (
                      <li key={m.id} className="flex items-start justify-between gap-3 bg-zinc-50 border rounded-lg px-4 py-3">
                        <span className="text-zinc-700 text-sm leading-relaxed">{m.text}</span>
                        <button onClick={() => handleDeleteFact(m.id)} className="text-zinc-400 hover:text-red-600 text-sm shrink-0" title="Remove">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
