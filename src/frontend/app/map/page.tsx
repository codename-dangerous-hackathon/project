"use client";

// Nearby Places map (/map): plots Toronto Open Data points on OpenStreetMap via
// Leaflet, with a toggle per dataset. Leaflet is loaded inside an effect (it
// touches `window`, so it must not run during SSR). circleMarkers are used
// instead of image markers to avoid the classic bundler icon-path problem.
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Point = { lat: number; lng: number; fields: Record<string, string> };

const LAYERS = [
  { key: "washrooms", label: "Public Washrooms", color: "#2563eb" },
  { key: "ltc", label: "Long-Term Care Homes", color: "#dc2626" },
  { key: "reccentres", label: "Community & Rec Centres", color: "#16a34a" },
] as const;

// Map a map layer to the backend places-tool category for "nearest to me".
const BACKEND_CAT: Record<string, string> = {
  washrooms: "washroom",
  ltc: "carehome",
  reccentres: "community",
};

type LayerKey = (typeof LAYERS)[number]["key"];

// Which fields to show in the popup, in order, with friendly labels.
const POPUP_FIELDS: Record<LayerKey, [string, string][]> = {
  washrooms: [
    ["address", "Address"],
    ["hours", "Hours"],
    ["accessible", "Accessible"],
    ["type", "Type"],
    ["status", "Status"],
  ],
  ltc: [
    ["address", "Address"],
    ["beds", "Beds"],
    ["phone", "Phone"],
    ["respite", "Respite"],
    ["adult_day_program", "Adult day program"],
  ],
  reccentres: [
    ["address", "Address"],
    ["amenities", "Amenities"],
    ["phone", "Phone"],
  ],
};

const esc = (x: string) =>
  x.replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string
  ));

function popupHtml(key: LayerKey, p: Point): string {
  const fl = p.fields;
  const rows = POPUP_FIELDS[key]
    .filter(([f]) => fl[f] && fl[f] !== "None")
    .map(([f, label]) => `<div><span style="color:#6b7280">${label}:</span> ${esc(fl[f])}</div>`)
    .join("");
  const link =
    key === "washrooms" && fl.url
      ? `<a href="${esc(fl.url)}" target="_blank" rel="noopener" style="color:#2563eb">More info ↗</a>`
      : "";
  return (
    `<div style="font-family:system-ui;min-width:180px">` +
    `<div style="font-weight:600;margin-bottom:4px">${esc(fl.name)}</div>` +
    `<div style="font-size:13px;line-height:1.5">${rows}${link}</div></div>`
  );
}

export default function MapPage() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const groupsRef = useRef<Record<string, unknown>>({});
  const [enabled, setEnabled] = useState<Record<LayerKey, boolean>>({
    washrooms: true,
    ltc: true,
    reccentres: true,
  });
  const [counts, setCounts] = useState<Partial<Record<LayerKey, number>>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // "Nearest to me" state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nearestGroupRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nearestMarkersRef = useRef<Record<string, any>>({});
  const [finding, setFinding] = useState(false);
  const [nearest, setNearest] = useState<
    { key: string; name: string; address: string; lat: number; lng: number; distance_m: number }[]
  >([]);

  const handleFindNearest = () => {
    const L = LRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any;
    if (!L || !map) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErrMsg("Location isn't available on this device.");
      return;
    }
    setFinding(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (nearestGroupRef.current) map.removeLayer(nearestGroupRef.current);
        const group = L.layerGroup().addTo(map);
        nearestGroupRef.current = group;
        nearestMarkersRef.current = {};
        L.circleMarker([lat, lng], {
          radius: 9, color: "#fff", weight: 3, fillColor: "#7c3aed", fillOpacity: 1,
        }).bindPopup("You are here").addTo(group);
        map.setView([lat, lng], 14);

        const results: typeof nearest = [];
        for (const layer of LAYERS) {
          if (!enabled[layer.key]) continue;
          try {
            const res = await fetch(
              `/api/places/nearest?category=${BACKEND_CAT[layer.key]}&lat=${lat}&lng=${lng}&n=1`
            );
            const r = (await res.json()).results?.[0];
            if (r) {
              results.push({ key: layer.key, name: r.name, address: r.address, lat: r.lat, lng: r.lng, distance_m: r.distance_m });
              const m = L.circleMarker([r.lat, r.lng], {
                radius: 11, color: layer.color, weight: 4, fillColor: "#fff", fillOpacity: 0.95,
              }).bindPopup(`<b>${r.name}</b><br>${r.distance_m} m away`).addTo(group);
              nearestMarkersRef.current[layer.key] = m;
            }
          } catch {
            /* skip */
          }
        }
        results.sort((a, b) => a.distance_m - b.distance_m);
        setNearest(results);
        setFinding(false);
      },
      () => {
        setErrMsg("Could not get your location (permission denied?).");
        setFinding(false);
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  // Initialize the map + load both datasets once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = (await import("leaflet")) as unknown as { default?: unknown };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L: any = (mod.default ?? mod) as any;
      LRef.current = L;
      if (cancelled || !mapEl.current || mapRef.current) return;

      const map = L.map(mapEl.current).setView([43.7, -79.38], 11); // Toronto
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 0);

      const allLatLng: [number, number][] = [];
      for (const layer of LAYERS) {
        const group = L.layerGroup().addTo(map);
        groupsRef.current[layer.key] = group;
        try {
          const res = await fetch(`/map/data/${layer.key}`);
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          const pts: Point[] = data.points ?? [];
          if (cancelled) return;
          setCounts((c) => ({ ...c, [layer.key]: pts.length }));
          for (const p of pts) {
            const marker = L.circleMarker([p.lat, p.lng], {
              radius: 6,
              color: "#ffffff",
              weight: 1,
              fillColor: layer.color,
              fillOpacity: 0.9,
            }).bindPopup(popupHtml(layer.key, p));
            group.addLayer(marker);
            allLatLng.push([p.lat, p.lng]);
          }
        } catch (e) {
          if (!cancelled) {
            setStatus("error");
            setErrMsg(`Could not load ${layer.label}: ${String(e)}`);
          }
        }
      }
      if (cancelled) return;
      if (allLatLng.length) map.fitBounds(allLatLng, { padding: [30, 30] });
      setStatus((s) => (s === "error" ? s : "ready"));
    })();

    return () => {
      cancelled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = mapRef.current as any;
      if (m) {
        m.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Add/remove a dataset's layer group when its toggle changes.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any;
    if (!map) return;
    for (const layer of LAYERS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const group = groupsRef.current[layer.key] as any;
      if (!group) continue;
      if (enabled[layer.key]) {
        if (!map.hasLayer(group)) group.addTo(map);
      } else if (map.hasLayer(group)) {
        map.removeLayer(group);
      }
    }
  }, [enabled]);

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-black/10 dark:border-white/15 bg-white dark:bg-black z-[1000]">
        <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
          <Link href="/" className="text-sm text-gray-600 dark:text-gray-300 hover:underline shrink-0">
            ← Belong
          </Link>
          <h1 className="font-semibold dark:text-zinc-50 shrink-0">Nearby Places</h1>
          <button
            onClick={handleFindNearest}
            disabled={finding}
            className="text-sm bg-violet-600 text-white rounded-full px-4 py-1.5 font-medium hover:bg-violet-500 disabled:opacity-60 shrink-0"
          >
            {finding ? "Locating…" : "📍 Nearest to me"}
          </button>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="ml-auto sm:hidden text-sm bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200 rounded-full px-3 py-1.5 font-medium"
          >
            {filtersOpen ? "Hide filters ▲" : "Filters ▼"}
          </button>
          <div className="hidden sm:flex ml-auto items-center gap-4 flex-wrap">
            {LAYERS.map((layer) => (
              <label key={layer.key} className="flex items-center gap-2 cursor-pointer select-none text-sm dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={enabled[layer.key]}
                  onChange={(e) => setEnabled((s) => ({ ...s, [layer.key]: e.target.checked }))}
                  className="accent-current"
                  style={{ accentColor: layer.color }}
                />
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: layer.color }} />
                {layer.label}
                {counts[layer.key] != null && (
                  <span className="text-gray-400">({counts[layer.key]})</span>
                )}
              </label>
            ))}
          </div>
        </div>
        {filtersOpen && (
          <div className="sm:hidden flex flex-col gap-2 px-4 pb-3 border-t border-black/5 dark:border-white/10 pt-2">
            {LAYERS.map((layer) => (
              <label key={layer.key} className="flex items-center gap-2 cursor-pointer select-none text-sm dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={enabled[layer.key]}
                  onChange={(e) => setEnabled((s) => ({ ...s, [layer.key]: e.target.checked }))}
                  className="accent-current"
                  style={{ accentColor: layer.color }}
                />
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: layer.color }} />
                {layer.label}
                {counts[layer.key] != null && (
                  <span className="text-gray-400">({counts[layer.key]})</span>
                )}
              </label>
            ))}
          </div>
        )}
      </header>

      <div className="relative flex-1">
        <div ref={mapEl} className="absolute inset-0" />
        {status === "loading" && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] rounded-full bg-white dark:bg-zinc-800 dark:text-zinc-100 shadow px-4 py-1.5 text-sm">
            Loading map data…
          </div>
        )}
        {status === "error" && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] rounded-md bg-red-50 text-red-700 border border-red-200 shadow px-4 py-2 text-sm max-w-md text-center">
            {errMsg}
          </div>
        )}
        {nearest.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] w-[90%] max-w-md rounded-xl bg-white dark:bg-zinc-800 shadow-lg p-3 text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold dark:text-zinc-100">Nearest to you</span>
              <button onClick={() => setNearest([])} className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200">✕</button>
            </div>
            {nearest.map((n) => (
              <button
                key={n.key}
                onClick={() => {
                  const m = nearestMarkersRef.current[n.key];
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const map = mapRef.current as any;
                  if (m && map) { map.setView([n.lat, n.lng], 15); m.openPopup(); }
                }}
                className="flex items-center w-full text-left py-1.5 px-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-zinc-200"
              >
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 shrink-0" style={{ background: LAYERS.find((l) => l.key === n.key)?.color }} />
                <span className="truncate">{n.name}</span>
                <span className="text-gray-400 ml-auto pl-2 shrink-0">
                  {n.distance_m < 1000 ? `${n.distance_m} m` : `${(n.distance_m / 1000).toFixed(1)} km`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
