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
type Recurrence = "once" | "daily" | "weekly" | "monthly";
type EventItem = {
  id: string;
  type: "medication" | "appointment" | "family" | "activity" | "waste_pickup";
  title: string;
  notes?: string;
  time: string;
  date?: string;
  recurrence: Recurrence;
};

// Does an event fall on a given YYYY-MM-DD (for rendering on the calendar)?
function occursOn(e: EventItem, ds: string): boolean {
  if (e.recurrence === "daily") return true;
  if (!e.date || ds < e.date) return false;
  if (e.recurrence === "once") return e.date === ds;
  const start = new Date(e.date + "T00:00:00");
  const cur = new Date(ds + "T00:00:00");
  if (e.recurrence === "weekly") return start.getDay() === cur.getDay();
  if (e.recurrence === "monthly") return start.getDate() === cur.getDate();
  return e.date === ds;
}

function recurrenceLabel(e: EventItem): string {
  if (e.recurrence === "daily") return `every day at ${e.time}`;
  if (e.recurrence === "weekly")
    return `every ${new Date((e.date || "") + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" })} at ${e.time}`;
  if (e.recurrence === "monthly")
    return `monthly on day ${new Date((e.date || "") + "T00:00:00").getDate()} at ${e.time}`;
  return `${e.date} at ${e.time}`;
}
type DiscoverEvent = {
  title: string;
  url: string;
  start: string;
  end: string;
  online: boolean;
  venue: string;
  city: string;
  image: string;
  description: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPE_STYLE: Record<string, { icon: string; cls: string }> = {
  medication: { icon: "💊", cls: "bg-amber-100 text-amber-800" },
  appointment: { icon: "📅", cls: "bg-blue-100 text-blue-800" },
  family: { icon: "👪", cls: "bg-purple-100 text-purple-800" },
  activity: { icon: "🎟️", cls: "bg-emerald-100 text-emerald-800" },
  waste_pickup: { icon: "♻️", cls: "bg-green-100 text-green-800" },
};

function CalendarMonth({
  events,
  onDayClick,
  onEventClick,
}: {
  events: EventItem[];
  onDayClick: (date: string) => void;
  onEventClick: (ev: EventItem) => void;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const first = new Date(cursor.y, cursor.m, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const monthName = first.toLocaleString(undefined, { month: "long", year: "numeric" });
  const dateStr = (day: number) => `${cursor.y}-${pad(cursor.m + 1)}-${pad(day)}`;
  const eventsForDay = (ds: string) => events.filter((e) => occursOn(e, ds));

  const prev = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const next = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="bg-white border rounded-2xl p-4 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prev} className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 text-zinc-600 text-xl" aria-label="Previous month">‹</button>
        <h3 className="font-semibold text-lg">{monthName}</h3>
        <button onClick={next} className="px-3 py-1.5 rounded-lg hover:bg-zinc-100 text-zinc-600 text-xl" aria-label="Next month">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-zinc-400 mb-1">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const ds = dateStr(day);
          const dayEvents = eventsForDay(ds);
          const isToday = ds === todayStr;
          return (
            <div
              key={i}
              onClick={() => onDayClick(ds)}
              className={`cursor-pointer min-h-[56px] sm:min-h-[88px] rounded-lg border p-1 sm:p-1.5 hover:border-zinc-400 transition-colors ${isToday ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}
            >
              <div className={`text-xs mb-1 ${isToday ? "font-bold text-zinc-900" : "text-zinc-500"}`}>{day}</div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((ev) => {
                  const st = TYPE_STYLE[ev.type] || TYPE_STYLE.family;
                  return (
                    <span
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                      className={`block truncate rounded px-0.5 sm:px-1 py-0.5 text-[9px] sm:text-[10px] leading-tight ${st.cls}`}
                      title={`${ev.title} at ${ev.time}${ev.recurrence === "daily" ? " (every day)" : ""} — click to remove`}
                    >
                      {st.icon} {ev.time} {ev.title}
                    </span>
                  );
                })}
                {dayEvents.length > 3 && (
                  <span className="block text-[10px] text-zinc-400">+{dayEvents.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-zinc-400 mt-3">Tap a day to add an event · tap an event to remove it</p>
    </div>
  );
}

const MOOD_EMOJI: Record<string, string> = {
  great: "😊", good: "🙂", okay: "😐", low: "😟", sad: "😢",
};

export default function CaregiverPage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "family" | "notes" | "calendar" | "mood">("dashboard");

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
  const [evRecurrence, setEvRecurrence] = useState<Recurrence>("daily");
  const [evStatus, setEvStatus] = useState("");

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/events", { cache: "no-store" });
      const data = await res.json();
      setEvents(data.events || []);
    } catch {
      /* offline */
    }
  }, []);

  // Mood check-ins (patient wellbeing history)
  const [moods, setMoods] = useState<{ id: string; mood: string; note: string; created_at: string }[]>([]);
  const loadMoods = useCallback(async () => {
    try {
      const res = await fetch("/api/mood", { cache: "no-store" });
      setMoods((await res.json()).moods || []);
    } catch {
      /* offline */
    }
  }, []);
  const deleteMood = async (id: string) => {
    try {
      await fetch(`/api/mood/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    loadMoods();
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evTitle.trim()) {
      setEvStatus("⚠️ Please enter a title.");
      return;
    }
    if (evRecurrence !== "daily" && !evDate) {
      setEvStatus("⚠️ Please pick a date for this event.");
      return;
    }
    const body = {
      type: evType,
      title: evTitle,
      notes: evNotes,
      time: evTime,
      date: evRecurrence === "daily" ? "" : evDate,
      recurrence: evRecurrence,
    };
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const when =
      evRecurrence === "daily" ? `every day at ${evTime}`
      : evRecurrence === "weekly" ? `every week (from ${evDate}) at ${evTime}`
      : evRecurrence === "monthly" ? `every month (from ${evDate}) at ${evTime}`
      : `on ${evDate} at ${evTime}`;
    setEvStatus(`✅ Saved. Reminds ${when}.`);
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

  // Discover public dementia events (Eventbrite)
  const [discover, setDiscover] = useState<DiscoverEvent[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverLocation, setDiscoverLocation] = useState("online");

  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const res = await fetch(`/api/discover/events?location=${encodeURIComponent(discoverLocation)}&limit=12`, { cache: "no-store" });
      const data = await res.json();
      setDiscover(data.events || []);
    } catch {
      setDiscover([]);
    }
    setDiscoverLoading(false);
  }, [discoverLocation]);

  const addDiscoveredEvent = async (ev: DiscoverEvent) => {
    const [date, t] = (ev.start || "").split("T");
    const time = (t || "10:00").slice(0, 5);
    const where = ev.online ? "Online event" : [ev.venue, ev.city].filter(Boolean).join(", ");
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "activity",
        title: ev.title,
        notes: `${where}${where ? " — " : ""}${ev.url}`,
        time,
        date: date || "",
        recurrence: "once",
      }),
    });
    await loadEvents();
    setEvStatus(`✅ Added "${ev.title}" to the calendar.`);
  };

  const handleCalendarDayClick = (ds: string) => {
    setEvDate(ds);
    if (evType === "medication") setEvType("appointment");
  };
  const handleCalendarEventClick = (ev: EventItem) => {
    if (typeof window !== "undefined" && window.confirm(`Remove "${ev.title}" from the calendar?`)) {
      deleteEvent(ev.id);
    }
  };

  // Patient profile ("About Me")
  const [profileName, setProfileName] = useState("");
  const [profileTagline, setProfileTagline] = useState("");
  const [profilePhoto, setProfilePhoto] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [medical, setMedical] = useState("");
  const [profileStatus, setProfileStatus] = useState("");

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile", { cache: "no-store" });
      const p = await res.json();
      setProfileName(p.name || "");
      setProfileTagline(p.tagline || "");
      setProfilePhoto(p.photo || "");
      setEmergencyName(p.emergency_name || "");
      setEmergencyPhone(p.emergency_phone || "");
      setMedical(p.medical || "");
    } catch {
      /* offline */
    }
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileStatus("Saving…");
    try {
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          tagline: profileTagline,
          photo: profilePhoto,
          emergency_name: emergencyName,
          emergency_phone: emergencyPhone,
          medical,
        }),
      });
      setProfileStatus("✅ Saved.");
      setTimeout(() => setProfileStatus(""), 2500);
    } catch {
      setProfileStatus("❌ Could not save.");
    }
  };

  // Import the emergency contact from the phone (Samsung Internet / Chrome on Android).
  const importFromContacts = async () => {
    const nav = navigator as unknown as {
      contacts?: { select: (p: string[], o: { multiple: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>> };
    };
    if (!("contacts" in navigator) || !("ContactsManager" in window) || !nav.contacts) {
      setProfileStatus("⚠️ Picking a contact needs Samsung Internet or Chrome on Android. You can upload a .vcf card instead.");
      return;
    }
    try {
      const contacts = await nav.contacts.select(["name", "tel"], { multiple: false });
      const c = contacts?.[0];
      if (c) {
        if (c.name?.[0]) setEmergencyName(c.name[0]);
        if (c.tel?.[0]) setEmergencyPhone(c.tel[0]);
        setProfileStatus("✅ Imported from your contacts — review and Save Profile.");
      }
    } catch {
      /* user cancelled the picker */
    }
  };

  // Import the emergency contact from an exported vCard (.vcf) — works everywhere.
  const importVCard = async (file: File) => {
    const text = await file.text();
    const fn = text.match(/^FN[^:]*:(.+)$/im);
    const tel = text.match(/^TEL[^:]*:(.+)$/im);
    const note = text.match(/^NOTE[^:]*:(.+)$/im);
    if (fn) setEmergencyName(fn[1].trim());
    if (tel) setEmergencyPhone(tel[1].trim());
    if (note) setMedical(note[1].trim().replace(/\\n/g, " ")); // vCard may carry medical info in NOTE
    setProfileStatus(fn || tel || note ? "✅ Imported from card — review and Save Profile." : "⚠️ Couldn't read a name/number from that file.");
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
      const res = await fetch("/api/journal", { cache: "no-store" });
      const data = await res.json();
      setPeople(data.people || []);
      setGeneral(data.general || []);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    if (activeTab === "dashboard") {
      // The dashboard rolls up everything, so pull from every section.
      load();
      loadEvents();
      loadProfile();
    }
    if (activeTab === "family" || activeTab === "notes") load();
    if (activeTab === "notes") {
      loadProfile();
      loadPhotoMems();
    }
    if (activeTab === "calendar") {
      loadEvents();
      loadDiscover();
    }
    if (activeTab === "mood") loadMoods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Derived "today" view for the dashboard.
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const nowHM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const todaysEvents = events
    .filter((e) => occursOn(e, todayStr))
    .sort((a, b) => a.time.localeCompare(b.time));
  const nextEvent = todaysEvents.find((e) => e.time >= nowHM);
  const totalFacts = people.reduce((sum, p) => sum + p.memory_count, 0);

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
    await load();
    if (data.status === "no_face") {
      alert("Photo saved — it will show on the patient's About Me. (No clear face was detected, so 'Who is this?' camera recognition won't use this one.)");
    }
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

  // --- Photo memories (a picture + a caption) ---
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoB64, setPhotoB64] = useState("");
  const [photoStatus, setPhotoStatus] = useState("");
  const [photoMems, setPhotoMems] = useState<{ id: string; caption: string }[]>([]);

  const loadPhotoMems = useCallback(async () => {
    try {
      const res = await fetch("/api/photo-journal", { cache: "no-store" });
      setPhotoMems((await res.json()).photos || []);
    } catch {
      /* offline */
    }
  }, []);

  const handleAddPhotoMemory = async () => {
    if (!photoCaption.trim() || !photoB64) {
      setPhotoStatus("⚠️ Add a caption and a photo.");
      return;
    }
    setPhotoStatus("Saving…");
    try {
      const res = await fetch("/api/memories/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: photoCaption, image_base64: photoB64 }),
      });
      if (res.ok) {
        setPhotoCaption("");
        setPhotoB64("");
        setPhotoStatus("✅ Added.");
        setTimeout(() => setPhotoStatus(""), 2500);
        await loadPhotoMems();
      } else {
        setPhotoStatus("❌ Could not save that photo.");
      }
    } catch {
      setPhotoStatus("❌ Backend offline.");
    }
  };

  const handleDeletePhotoMemory = async (id: string) => {
    try {
      await fetch(`/api/memories/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    loadPhotoMems();
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
          <span className="hidden sm:flex bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 px-3 py-1 rounded-full text-xs font-medium items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Secure Offline Mode
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto mt-8 px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Sidebar */}
        <aside className="md:col-span-1 flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1">
          {([
            ["dashboard", "📊 Daily Dashboard"],
            ["family", "👪 Family Members"],
            ["calendar", "🗓️ Calendar"],
            ["mood", "💚 Wellbeing"],
            ["notes", "📖 Patient Notes"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`text-left shrink-0 whitespace-nowrap px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === key ? "bg-zinc-900 text-white shadow-md" : "bg-zinc-100 md:bg-transparent hover:bg-zinc-200 text-zinc-600"}`}
            >
              {label}
            </button>
          ))}
        </aside>

        {/* Content */}
        <section className="md:col-span-3">
          {/* DASHBOARD — a live rollup of every section */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <h2 className="text-3xl font-semibold tracking-tight">Daily Dashboard</h2>
                <span className="text-sm text-zinc-500">
                  {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                </span>
              </div>

              {/* Patient identity */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm flex items-center gap-5">
                {profilePhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profilePhoto} alt={profileName || "patient"} className="w-20 h-20 rounded-full object-cover border shrink-0" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-zinc-200 flex items-center justify-center text-3xl font-semibold text-zinc-500 shrink-0">
                    {(profileName || "?")[0]?.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-2xl font-semibold">{profileName || "Unnamed patient"}</div>
                  {profileTagline ? (
                    <p className="text-zinc-600 mt-1">{profileTagline}</p>
                  ) : (
                    <button onClick={() => setActiveTab("notes")} className="text-sm text-blue-600 hover:underline mt-1">
                      Add a description →
                    </button>
                  )}
                </div>
              </div>

              {/* Quick stats — each jumps to its section */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {([
                  { label: "Family", value: people.length, tab: "family", icon: "👪" },
                  { label: "Facts stored", value: totalFacts, tab: "family", icon: "🧠" },
                  { label: "General notes", value: general.length, tab: "notes", icon: "📖" },
                  { label: "Reminders", value: events.length, tab: "calendar", icon: "🗓️" },
                ] as const).map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setActiveTab(s.tab)}
                    className="bg-white border rounded-2xl p-4 shadow-sm text-left hover:border-zinc-400 transition-colors"
                  >
                    <div className="text-2xl">{s.icon}</div>
                    <div className="text-3xl font-semibold mt-1">{s.value}</div>
                    <div className="text-zinc-500 text-sm">{s.label}</div>
                  </button>
                ))}
              </div>

              {/* Today's schedule */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-lg">🗓️ Today&apos;s schedule</h3>
                  <button onClick={() => setActiveTab("calendar")} className="text-sm text-blue-600 hover:underline">Manage →</button>
                </div>
                {todaysEvents.length === 0 ? (
                  <p className="text-zinc-400 text-sm">Nothing scheduled today.</p>
                ) : (
                  <ul className="space-y-2">
                    {todaysEvents.map((ev) => {
                      const st = TYPE_STYLE[ev.type] || TYPE_STYLE.family;
                      const isNext = !!nextEvent && ev.id === nextEvent.id;
                      const past = ev.time < nowHM;
                      return (
                        <li
                          key={ev.id}
                          className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${isNext ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"} ${past && !isNext ? "opacity-50" : ""}`}
                        >
                          <span className={`text-sm font-mono px-2 py-1 rounded shrink-0 ${st.cls}`}>{st.icon} {ev.time}</span>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{ev.title}</div>
                            {ev.notes && <div className="text-zinc-400 text-xs truncate">{ev.notes}</div>}
                          </div>
                          {isNext && <span className="ml-auto shrink-0 text-xs font-medium text-amber-900 bg-amber-200 rounded-full px-2 py-0.5">Up next</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Emergency contact + medical notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-rose-900">🚨 Emergency contact</h3>
                    <button onClick={() => setActiveTab("notes")} className="text-xs text-rose-700 hover:underline">Edit</button>
                  </div>
                  {emergencyName || emergencyPhone ? (
                    <>
                      <div className="text-lg font-semibold text-rose-900">{emergencyName || "—"}</div>
                      {emergencyPhone && <a href={`tel:${emergencyPhone}`} className="text-rose-700 hover:underline">{emergencyPhone}</a>}
                    </>
                  ) : (
                    <p className="text-rose-700/70 text-sm">No emergency contact set.</p>
                  )}
                </div>
                <div className="bg-white border rounded-2xl p-6 shadow-sm">
                  <h3 className="font-medium mb-2">🩺 Medical notes</h3>
                  {medical ? (
                    <p className="text-zinc-600 text-sm whitespace-pre-wrap">{medical}</p>
                  ) : (
                    <p className="text-zinc-400 text-sm">None recorded.</p>
                  )}
                </div>
              </div>

              {/* Family at a glance */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-lg">👪 Family at a glance</h3>
                  <button onClick={() => setActiveTab("family")} className="text-sm text-blue-600 hover:underline">Manage →</button>
                </div>
                {people.length === 0 ? (
                  <p className="text-zinc-400 text-sm">No family members yet.</p>
                ) : (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {people.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 border rounded-xl p-3">
                        {p.has_photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/people/${p.id}/photo`} alt={p.name} className="w-10 h-10 rounded-full object-cover border shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-zinc-200 flex items-center justify-center text-zinc-500 font-semibold shrink-0">
                            {p.name[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {p.name} <span className="text-zinc-500 font-normal">· {p.relationship}</span>
                          </div>
                          <div className="text-xs text-zinc-400">{p.memory_count} {p.memory_count === 1 ? "fact" : "facts"}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Recent general notes */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-lg">📖 Recent notes</h3>
                  <button onClick={() => setActiveTab("notes")} className="text-sm text-blue-600 hover:underline">Manage →</button>
                </div>
                {general.length === 0 ? (
                  <p className="text-zinc-400 text-sm">No general notes yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {general.slice(0, 5).map((m) => (
                      <li key={m.id} className="text-sm text-zinc-700 bg-zinc-50 border rounded-lg px-4 py-2">{m.text}</li>
                    ))}
                    {general.length > 5 && <li className="text-xs text-zinc-400">+{general.length - 5} more in Patient Notes</li>}
                  </ul>
                )}
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

                            {/* Add or replace the photo (shows on the patient's About Me + enables recognition) */}
                            <label className="block text-sm text-zinc-600">
                              {p.has_photo
                                ? "📷 Replace photo (shows on the patient's About Me):"
                                : "📷 Add a photo (shows on About Me + enables face recognition):"}
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAddPhotoToPerson(p.id, f); }}
                                className="mt-1 block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-zinc-200"
                              />
                            </label>
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
              <div className="flex items-center justify-between border-b pb-4 gap-3 flex-wrap">
                <h2 className="text-3xl font-semibold tracking-tight">Calendar &amp; Reminders</h2>
                <button onClick={sendTestReminder} className="text-sm bg-zinc-200 hover:bg-zinc-300 rounded-lg px-3 py-2 font-medium">
                  🔔 Send test reminder
                </button>
              </div>

              {/* Month calendar */}
              <CalendarMonth
                events={events}
                onDayClick={handleCalendarDayClick}
                onEventClick={handleCalendarEventClick}
              />

              {/* Add event */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-2">Add an Event</h3>
                <p className="text-zinc-500 text-sm mb-6">
                  Choose how often it repeats — <b>once</b>, <b>daily</b>, <b>weekly</b>, or <b>monthly</b>. The patient&apos;s tablet gets a push notification at the set time.
                </p>
                <form onSubmit={handleAddEvent} className="space-y-4 max-w-md">
                  <div className="flex gap-2">
                    {(["medication", "appointment", "family"] as const).map((t) => (
                      <button
                        type="button"
                        key={t}
                        onClick={() => { setEvType(t); setEvRecurrence(t === "medication" ? "daily" : "once"); }}
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
                  <div className="flex gap-3 flex-wrap">
                    <label className="flex-1 text-sm text-zinc-600 min-w-[120px]">
                      Repeats
                      <select
                        value={evRecurrence}
                        onChange={(e) => setEvRecurrence(e.target.value as Recurrence)}
                        className="mt-1 w-full border rounded-lg px-3 py-2 bg-zinc-50"
                      >
                        <option value="once">Once</option>
                        <option value="daily">Every day</option>
                        <option value="weekly">Every week</option>
                        <option value="monthly">Every month</option>
                      </select>
                    </label>
                    <label className="flex-1 text-sm text-zinc-600 min-w-[110px]">
                      Time
                      <input type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 bg-zinc-50" />
                    </label>
                    {evRecurrence !== "daily" && (
                      <label className="flex-1 text-sm text-zinc-600 min-w-[140px]">
                        {evRecurrence === "once" ? "Date" : "Starting"}
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
                            {ev.type === "medication" ? "💊" : ev.type === "appointment" ? "📅" : ev.type === "activity" ? "🎟️" : "👪"} {ev.title}
                          </span>
                          <span className="text-zinc-500 text-sm ml-2">
                            {recurrenceLabel(ev)}
                          </span>
                          {ev.notes && <div className="text-zinc-400 text-xs mt-0.5 break-all">{ev.notes}</div>}
                        </div>
                        <button onClick={() => deleteEvent(ev.id)} className="text-zinc-400 hover:text-red-600 shrink-0" title="Remove">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Discover dementia events from Eventbrite */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                  <h3 className="font-medium text-lg">🎟️ Discover dementia events</h3>
                  <div className="flex items-center gap-2">
                    <input
                      value={discoverLocation}
                      onChange={(e) => setDiscoverLocation(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") loadDiscover(); }}
                      className="border rounded-lg px-3 py-1.5 text-sm bg-zinc-50 w-40"
                      placeholder="online, toronto, …"
                      title="Eventbrite location, e.g. online or a city"
                    />
                    <button onClick={loadDiscover} className="text-sm bg-zinc-900 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-zinc-800">
                      Search
                    </button>
                  </div>
                </div>
                <p className="text-zinc-500 text-sm mb-4">
                  Public events from Eventbrite. Add any to the patient&apos;s calendar with one tap.
                </p>
                {discoverLoading ? (
                  <p className="text-zinc-400 text-sm">Loading events…</p>
                ) : discover.length === 0 ? (
                  <p className="text-zinc-400 text-sm">No events found. Try a different location.</p>
                ) : (
                  <ul className="space-y-3">
                    {discover.map((ev, i) => (
                      <li key={ev.url || i} className="flex items-start justify-between gap-3 border rounded-xl p-4">
                        <div className="min-w-0">
                          <a href={ev.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                            {ev.title}
                          </a>
                          <div className="text-zinc-500 text-sm mt-0.5">
                            {ev.start ? new Date(ev.start).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Date TBD"}
                            {" · "}
                            {ev.online ? "Online" : [ev.venue, ev.city].filter(Boolean).join(", ") || "In person"}
                          </div>
                          {ev.description && <div className="text-zinc-400 text-xs mt-1 line-clamp-2">{ev.description}</div>}
                        </div>
                        <button
                          onClick={() => addDiscoveredEvent(ev)}
                          className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg px-3 py-2"
                          title="Add to the patient's calendar"
                        >
                          ➕ Add
                        </button>
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
              <h2 className="text-3xl font-semibold tracking-tight border-b pb-4">About the Patient</h2>

              {/* Patient profile — shown on the patient's "About Me" screen */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-2">Identity (shown on their &ldquo;About Me&rdquo; screen)</h3>
                <p className="text-zinc-500 text-sm mb-6">
                  Their name, photo, and a warm one-line description — so the patient can re-anchor on who they are.
                </p>
                <form onSubmit={saveProfile} className="space-y-4 max-w-md">
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                    placeholder="Name — e.g. Helen"
                  />
                  <input
                    type="text"
                    value={profileTagline}
                    onChange={(e) => setProfileTagline(e.target.value)}
                    className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                    placeholder="A warm line — e.g. You are a mother of three who loves gardening."
                  />
                  <div>
                    <label className="block text-sm font-medium mb-1 text-zinc-600">Photo (optional)</label>
                    {profilePhoto && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profilePhoto} alt="patient" className="w-20 h-20 rounded-full object-cover mb-2 border" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => { const f = e.target.files?.[0]; if (f) setProfilePhoto(await fileToBase64(f)); }}
                      className="w-full border rounded-lg px-4 py-2 bg-zinc-50 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-900 file:text-white"
                    />
                  </div>

                  {/* Emergency contact + medical (with import from the phone) */}
                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-sm font-semibold text-zinc-700">Emergency contact</span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={importFromContacts} className="text-xs bg-zinc-200 hover:bg-zinc-300 rounded-lg px-3 py-1.5 font-medium">
                          📇 Import from phone
                        </button>
                        <label className="text-xs bg-zinc-200 hover:bg-zinc-300 rounded-lg px-3 py-1.5 font-medium cursor-pointer">
                          Upload .vcf
                          <input
                            type="file"
                            accept=".vcf,text/vcard"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) importVCard(f); }}
                          />
                        </label>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                      placeholder="Emergency contact name — e.g. John (son)"
                    />
                    <input
                      type="tel"
                      value={emergencyPhone}
                      onChange={(e) => setEmergencyPhone(e.target.value)}
                      className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                      placeholder="Emergency phone — e.g. +1 416 555 0123"
                    />
                    <textarea
                      value={medical}
                      onChange={(e) => setMedical(e.target.value)}
                      className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none min-h-[70px]"
                      placeholder="Medical notes (optional) — allergies, conditions, blood type…"
                    />
                  </div>

                  <button type="submit" className="bg-zinc-900 text-white font-medium px-6 py-3 rounded-lg hover:bg-zinc-800 transition-colors">
                    Save Profile
                  </button>
                  {profileStatus && <span className="text-sm font-medium text-emerald-600 ml-3">{profileStatus}</span>}
                </form>
              </div>
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

              {/* Photo Memories — a picture + a caption (shown in the patient's Photo Journal) */}
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-4">Photo Memories</h3>
                <div className="space-y-3 mb-5">
                  <textarea
                    value={photoCaption}
                    onChange={(e) => setPhotoCaption(e.target.value)}
                    className="w-full border rounded-lg px-4 py-3 bg-zinc-50 focus:ring-2 outline-none min-h-[60px]"
                    placeholder="A caption — e.g., the trip to the lake with the grandkids in 1998."
                  />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => { const f = e.target.files?.[0]; setPhotoB64(f ? await fileToBase64(f) : ""); }}
                    className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-zinc-200"
                  />
                  <div className="flex items-center gap-4">
                    <button onClick={handleAddPhotoMemory} className="bg-zinc-900 text-white font-medium px-6 py-3 rounded-lg hover:bg-zinc-800 transition-colors">Add Photo Memory</button>
                    {photoStatus && <span className="text-sm font-medium text-emerald-600">{photoStatus}</span>}
                  </div>
                </div>
                {photoMems.length === 0 ? (
                  <p className="text-zinc-400 text-sm">No photo memories yet.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {photoMems.map((p) => (
                      <div key={p.id} className="relative border rounded-xl overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/memories/${p.id}/photo`} alt={p.caption} className="w-full h-28 object-cover" />
                        <div className="p-2 text-xs text-zinc-700 leading-snug">{p.caption}</div>
                        <button
                          onClick={() => handleDeletePhotoMemory(p.id)}
                          className="absolute top-1 right-1 bg-white/90 rounded-full w-6 h-6 text-zinc-500 hover:text-red-600 text-sm"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* WELLBEING — patient mood check-in history */}
          {activeTab === "mood" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <h2 className="text-3xl font-semibold tracking-tight">Mood Check-ins</h2>
                <span className="text-sm text-zinc-500">{moods.length} recorded</span>
              </div>
              {moods.length === 0 ? (
                <p className="text-zinc-500">
                  No check-ins yet. They appear here when the patient taps &ldquo;How I Feel&rdquo;.
                </p>
              ) : (
                <ul className="space-y-3">
                  {moods.map((m) => (
                    <li key={m.id} className="bg-white border rounded-2xl p-5 shadow-sm flex items-center gap-4">
                      <span className="text-4xl shrink-0">{MOOD_EMOJI[m.mood] || "🙂"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium capitalize">{m.mood}</div>
                        {m.note && <div className="text-sm text-zinc-600">{m.note}</div>}
                        <div className="text-xs text-zinc-400">{new Date(m.created_at).toLocaleString()}</div>
                      </div>
                      <button
                        onClick={() => deleteMood(m.id)}
                        className="text-zinc-400 hover:text-red-600 text-sm shrink-0"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
