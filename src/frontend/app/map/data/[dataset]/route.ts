// Server-side fetch + normalize for the /map page.
//
// Why a route handler: Toronto Open Data (CKAN) is fetched here on the server so
// the browser never makes a cross-origin request (no CORS to configure), and so
// Next can cache the response (these datasets change rarely). The browser just
// calls `/map/data/washrooms` | `/map/data/ltc` and gets a flat point list.
import type { NextRequest } from "next/server";

export const revalidate = 86400; // re-fetch from Toronto at most once a day

type Source = {
  url: string;
  // Map a GeoJSON feature's raw properties to the fields the popup shows.
  fields: (p: Record<string, unknown>) => Record<string, string>;
};

const s = (v: unknown) => (v == null ? "" : String(v).trim());

const SOURCES: Record<string, Source> = {
  washrooms: {
    url:
      "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/" +
      "394b9f09-d5d6-43dc-a7a0-660c99fc2318/resource/" +
      "8a9905cf-1b5b-49ca-8359-ac7971099b24/download/washroom-facilities-4326.geojson",
    fields: (p) => ({
      name: s(p.location) || s(p.alternative_name) || "Public Washroom",
      address: s(p.address),
      hours: s(p.hours),
      accessible: s(p.accessible),
      type: s(p.type),
      status: s(p.Status),
      url: s(p.url),
    }),
  },
  ltc: {
    url:
      "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/" +
      "308a036a-ceb5-488a-859f-4d7dc2fd592d/resource/" +
      "6bac587f-d8a7-4403-b279-8f1cf05ed20a/download/long-term-care-locations-4326.geojson",
    fields: (p) => ({
      name: s(p.NAME) || "Long-Term Care Home",
      address: [s(p.ADDRESS_FULL), s(p.POSTAL_CODE)].filter(Boolean).join(", "),
      beds: s(p.BEDS),
      phone: s(p.TELEPHONE),
      respite: s(p.RESPITE),
      adult_day_program: s(p.ADULT_DAY_PROGRAM),
    }),
  },
};

type Point = { lat: number; lng: number; fields: Record<string, string> };

function coordsOf(geometry: { type?: string; coordinates?: unknown }): number[][] {
  if (!geometry) return [];
  if (geometry.type === "Point") return [geometry.coordinates as number[]];
  if (geometry.type === "MultiPoint") return geometry.coordinates as number[][];
  return [];
}

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/map/data/[dataset]">
) {
  const { dataset } = await ctx.params;
  const src = SOURCES[dataset];
  if (!src) {
    return Response.json({ error: `unknown dataset: ${dataset}` }, { status: 404 });
  }

  let geo: { features?: Array<{ geometry: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }> };
  try {
    const r = await fetch(src.url, { next: { revalidate } });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    geo = await r.json();
  } catch (e) {
    return Response.json(
      { error: "Toronto Open Data unreachable", detail: String(e) },
      { status: 502 }
    );
  }

  const points: Point[] = [];
  for (const f of geo.features ?? []) {
    for (const c of coordsOf(f.geometry)) {
      const lng = Number(c?.[0]);
      const lat = Number(c?.[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        points.push({ lat, lng, fields: src.fields(f.properties ?? {}) });
      }
    }
  }

  return Response.json({ dataset, count: points.length, points });
}
