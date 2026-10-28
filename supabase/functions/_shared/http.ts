// Shared HTTP helpers: CORS + JSON responses.
// ALLOWED_ORIGINS (optional secret): comma-separated list, e.g.
//   "https://boliboard.pages.dev,http://localhost:8000"
// When unset, any origin is allowed (fine for test mode; set it before launch).

export function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  const allow = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function fail(req: Request, status: number, error: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json(req, status, { error, message, ...extra });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");
  return null;
}

/** Reads a JSON body even when it was sent as text/plain (navigator.sendBeacon). Caps size at 16 KB. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (text.length > 16_384) return null;
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function biddingOpen(): boolean {
  return (Deno.env.get("BIDDING_OPEN") ?? "").toLowerCase() === "true";
}
