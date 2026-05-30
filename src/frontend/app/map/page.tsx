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
] as const;

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
  });
  const [counts, setCounts] = useState<Partial<Record<LayerKey, number>>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");

  // Initialize the map + load both datasets once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = (await import("leaflet")) as unknown as { default?: unknown };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L: any = (mod.default ?? mod) as any;
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
      <header className="flex items-center gap-4 px-4 py-3 border-b border-black/10 dark:border-white/15 bg-white dark:bg-black z-[1000]">
        <Link href="/" className="text-sm text-gray-600 dark:text-gray-300 hover:underline">
          ← Belong
        </Link>
        <h1 className="font-semibold dark:text-zinc-50">Nearby Places</h1>
        <div className="ml-auto flex items-center gap-4">
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
      </div>
    </div>
  );
}
