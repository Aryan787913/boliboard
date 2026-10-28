// admin-upi: RETIRED 2026-10-28. The token-based admin.html is gone; the owner admin site uses admin-api
// (Supabase Auth email code + ADMIN_EMAILS allowlist). Every request is refused.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  return new Response(JSON.stringify({ error: "gone", message: "admin-upi is retired. Use the owner admin site." }), {
    status: 410,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
});
