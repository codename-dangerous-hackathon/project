"use client";

import { useState } from "react";

import Link from "next/link";

export default function CaregiverPage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "faces" | "memories">("dashboard");
  const [memoryText, setMemoryText] = useState("");
  const [enrollStatus, setEnrollStatus] = useState("");

  // Face enrollment state
  const [faceName, setFaceName] = useState("");
  const [faceRelationship, setFaceRelationship] = useState("");
  const [facePhoto, setFacePhoto] = useState<string>(""); // base64 data URL
  const [faceStatus, setFaceStatus] = useState("");
  const [faceSaving, setFaceSaving] = useState(false);

  const onPhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFacePhoto(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  };

  const handleEnrollFace = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate in JS (not via the `required` attribute) so the button always
    // gives visible feedback instead of silently failing browser validation.
    if (!faceName.trim() || !faceRelationship.trim()) {
      setFaceStatus("⚠️ Please enter both a name and a relationship.");
      return;
    }
    if (!facePhoto) {
      setFaceStatus("⚠️ Please choose a clear photo first.");
      return;
    }
    setFaceSaving(true);
    setFaceStatus("Extracting face embedding on-device...");
    try {
      const res = await fetch("/api/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: faceName,
          relationship: faceRelationship,
          image_base64: facePhoto,
        }),
      });
      let data: { status?: string; name?: string; message?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON error body */
      }
      if (res.ok && data?.status === "success") {
        setFaceStatus(`✅ ${data.name} enrolled. Photo discarded — only the embedding was kept.`);
        setFaceName("");
        setFaceRelationship("");
        setFacePhoto("");
      } else if (data?.status === "no_face") {
        setFaceStatus(`⚠️ ${data.message}`);
      } else {
        setFaceStatus(`❌ Failed to enroll (HTTP ${res.status}). Please try again.`);
      }
    } catch {
      setFaceStatus("❌ Backend is offline. Is FastAPI running?");
    } finally {
      setFaceSaving(false);
    }
  };

  const handleEnrollMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollStatus("Saving to Vector DB...");
    try {
      const res = await fetch("/api/enroll_memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: memoryText, tags: "life-story" })
      });
      if (res.ok) {
        setMemoryText("");
        setEnrollStatus("Memory successfully saved to the local offline Vault!");
        setTimeout(() => setEnrollStatus(""), 3000);
      } else {
        setEnrollStatus("Failed to save.");
      }
    } catch (err) {
      setEnrollStatus("Backend is offline. Is FastAPI running?");
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
              <h1 className="text-2xl font-bold tracking-tight">Anchor Caregiver UI</h1>
              <p className="text-zinc-400 text-sm mt-1">100% On-Device Family Portal</p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Secure Offline Mode
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto mt-8 px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Navigation Sidebar */}
        <aside className="md:col-span-1 flex flex-col gap-2">
          <button 
            onClick={() => setActiveTab("dashboard")}
            className={`text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === "dashboard" ? "bg-zinc-900 text-white shadow-md" : "hover:bg-zinc-200 text-zinc-600"}`}
          >
            📊 Daily Dashboard
          </button>
          <button 
            onClick={() => setActiveTab("faces")}
            className={`text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === "faces" ? "bg-zinc-900 text-white shadow-md" : "hover:bg-zinc-200 text-zinc-600"}`}
          >
            📷 Identity & Faces
          </button>
          <button 
            onClick={() => setActiveTab("memories")}
            className={`text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === "memories" ? "bg-zinc-900 text-white shadow-md" : "hover:bg-zinc-200 text-zinc-600"}`}
          >
            📖 Life Story Vault
          </button>
        </aside>

        {/* Content Area */}
        <section className="md:col-span-3">
          
          {/* DASHBOARD TAB */}
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

          {/* FACES TAB */}
          {activeTab === "faces" && (
            <div className="space-y-6">
              <h2 className="text-3xl font-semibold tracking-tight border-b pb-4">Identity Verification</h2>
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-2">Enroll a New Family Member</h3>
                <p className="text-zinc-500 text-sm mb-6">
                  Add photos of loved ones. The local InsightFace model will process the image into a secure embedding array. The original photo is discarded, maintaining privacy.
                </p>
                <form onSubmit={handleEnrollFace} className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium mb-1">Name</label>
                    <input
                      type="text"
                      value={faceName}
                      onChange={(e) => setFaceName(e.target.value)}
                      className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                      placeholder="e.g. Sarah"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Relationship</label>
                    <input
                      type="text"
                      value={faceRelationship}
                      onChange={(e) => setFaceRelationship(e.target.value)}
                      className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
                      placeholder="e.g. Daughter"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Clear Photo</label>
                    <input
                      type="file"
                      onChange={onPhotoSelected}
                      className="w-full border rounded-lg px-4 py-2 bg-zinc-50 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-900 file:text-white"
                      accept="image/*"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={faceSaving}
                    className="w-full bg-zinc-900 text-white font-medium py-3 rounded-lg hover:bg-zinc-800 transition-colors mt-2 disabled:opacity-60"
                  >
                    {faceSaving ? "Processing..." : "Extract Face Embedding"}
                  </button>
                  {faceStatus && (
                    <p className="text-sm font-medium text-zinc-700">{faceStatus}</p>
                  )}
                </form>
              </div>
            </div>
          )}

          {/* MEMORIES TAB */}
          {activeTab === "memories" && (
            <div className="space-y-6">
              <h2 className="text-3xl font-semibold tracking-tight border-b pb-4">Life Story Vault</h2>
              
              <div className="bg-white border rounded-2xl p-6 shadow-sm">
                <h3 className="font-medium text-lg mb-2">Add a Memory or Fact</h3>
                <p className="text-zinc-500 text-sm mb-6">
                  Teach the Companion about the patient's life. These facts are stored in ChromaDB and sent to the LLM automatically anytime the patient asks related questions.
                </p>
                <form onSubmit={handleEnrollMemory} className="space-y-4">
                  <textarea 
                    value={memoryText}
                    onChange={(e) => setMemoryText(e.target.value)}
                    required
                    className="w-full border rounded-lg px-4 py-3 bg-zinc-50 focus:ring-2 outline-none min-h-[120px]" 
                    placeholder="e.g., Helen grew up in Scarborough. She has a dog named Buster. She loves gardening and drinking Earl Grey tea." 
                  />
                  <div className="flex items-center gap-4">
                    <button type="submit" className="bg-zinc-900 text-white font-medium px-6 py-3 rounded-lg hover:bg-zinc-800 transition-colors">
                      Save to Local VectorDB
                    </button>
                    {enrollStatus && <span className="text-sm font-medium text-emerald-600">{enrollStatus}</span>}
                  </div>
                </form>
              </div>

            </div>
          )}
        </section>
      </div>
    </main>
  );
}
