"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export type MemoryPlace = {
  id: string;
  label: string;
  address: string;
  note: string;
  lat: number;
  lng: number;
  has_streetview: boolean;
  image_url: string | null;
  streetview_error?: string | null;
};

export default function MemoryJournalTab() {
  const [places, setPlaces] = useState<MemoryPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const loadPlaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/places", { cache: "no-store" });
      const data = await res.json();
      setPlaces(data.places || []);
    } catch {
      setPlaces([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPlaces();
  }, [loadPlaces]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !address.trim()) {
      setStatus("⚠️ Please enter a label and a Toronto street address.");
      return;
    }
    setSaving(true);
    setStatus("Geocoding address and loading Street View…");
    try {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, address, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`❌ ${data.detail || "Could not save this place."}`);
        return;
      }
      setStatus(
        data.streetview_error
          ? `✅ Place saved. Street View lookup failed: ${data.streetview_error}`
          : data.has_streetview
          ? "✅ Place saved with Street View photo."
          : "✅ Place saved. No Street View imagery at this address — showing a placeholder."
      );
      setLabel("");
      setAddress("");
      setNote("");
      await loadPlaces();
    } catch {
      setStatus("❌ Backend is offline. Is FastAPI running?");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Remove this memory place?")) return;
    await fetch(`/api/places/${id}`, { method: "DELETE" });
    await loadPlaces();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-semibold tracking-tight border-b pb-4">Memory Journal</h2>
      <p className="text-zinc-500 text-sm -mt-2">
        Save meaningful Toronto locations with a memory note. Each place appears here and on the{" "}
        <Link href="/map" className="text-zinc-700 underline hover:text-zinc-900">
          service map
        </Link>{" "}
        as a distinct marker.
      </p>

      <div className="bg-white border rounded-2xl p-6 shadow-sm">
        <h3 className="font-medium text-lg mb-2">Add a Place</h3>
        <p className="text-zinc-500 text-sm mb-6">
          Enter a label, a street address in Toronto, and a short memory note.
        </p>
        <form onSubmit={handleAdd} className="space-y-4 max-w-md">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
            placeholder='Label — e.g. "Our first home"'
          />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full border rounded-lg px-4 py-2 bg-zinc-50 focus:ring-2 outline-none"
            placeholder="Street address in Toronto — e.g. 123 Queen St W"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border rounded-lg px-4 py-3 bg-zinc-50 focus:ring-2 outline-none min-h-[88px]"
            placeholder="Memory note — e.g. We moved here in 1962. Helen loved the garden out back."
          />
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-zinc-900 text-white font-medium py-3 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Place"}
          </button>
          {status && <p className="text-sm font-medium text-zinc-700">{status}</p>}
        </form>
      </div>

      <div>
        <h3 className="font-medium text-lg mb-4">Saved Places ({places.length})</h3>
        {loading ? (
          <p className="text-zinc-400 text-sm">Loading places…</p>
        ) : places.length === 0 ? (
          <p className="text-zinc-400 text-sm">No memory places yet. Add one above.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {places.map((p) => (
              <article key={p.id} className="bg-white border rounded-2xl overflow-hidden shadow-sm flex flex-col">
                {p.has_streetview && p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_url}
                    alt={`Street View of ${p.label}`}
                    className="w-full h-40 object-cover bg-zinc-100"
                  />
                ) : p.streetview_error ? (
                  <div className="w-full h-40 bg-zinc-100 flex items-center justify-center px-4 text-center text-sm text-rose-600">
                    Street View lookup failed: {p.streetview_error}
                  </div>
                ) : (
                  <div className="w-full h-40 bg-zinc-100 flex items-center justify-center px-4 text-center text-sm text-zinc-500">
                    No Street View imagery for this address
                  </div>
                )}
                <div className="p-4 flex flex-col flex-1 gap-2">
                  <h4 className="font-semibold text-lg">{p.label}</h4>
                  <p className="text-xs text-zinc-400">{p.address}</p>
                  {p.note ? (
                    <p className="text-sm text-zinc-600 leading-relaxed flex-1">{p.note}</p>
                  ) : (
                    <p className="text-sm text-zinc-400 italic flex-1">No note</p>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Link
                      href={`/map?lat=${p.lat}&lng=${p.lng}&zoom=17&label=${encodeURIComponent(p.label)}`}
                      className="flex-1 text-center text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-2"
                    >
                      Show on map
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      className="px-3 py-2 text-sm text-zinc-500 hover:text-red-600 border rounded-lg"
                      title="Delete place"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
