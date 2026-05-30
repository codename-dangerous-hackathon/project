// Same-origin proxy to the Hermes agent (OpenAI-compatible) endpoint.
//
// Why this exists: Hermes 403s any request that carries a browser `Origin`
// header (its allowlist only trusts server-side callers). By proxying through
// this Route Handler we (a) strip the Origin so Hermes returns 200, and
// (b) keep the browser talking to the SAME origin as the app, so there is no
// CORS to configure at all. The front end just calls BASE_URL = "/v1".
//
// Override the upstream with HERMES_UPSTREAM (e.g. when the relay IP changes).
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic"; // never cache or prerender — always live

const UPSTREAM = (
  process.env.HERMES_UPSTREAM || "http://10.10.53.32:8643/v1"
).replace(/\/+$/, "");

async function proxy(request: Request, path: string[]) {
  const search = new URL(request.url).search;
  const target = `${UPSTREAM}/${path.join("/")}${search}`;

  // Forward only what the upstream needs. Deliberately NOT forwarding
  // Origin / Referer / Host — that is the whole point (see header above).
  const headers = new Headers();
  for (const h of ["content-type", "authorization", "accept"]) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Hermes upstream unreachable", detail: String(e) }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  // Stream the body straight back (this is what makes SSE token streaming work).
  const respHeaders = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) respHeaders.set("content-type", ct);
  respHeaders.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/v1/[...path]">) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function POST(request: NextRequest, ctx: RouteContext<"/v1/[...path]">) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

// Harmless safety net; same-origin requests won't actually preflight.
export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
