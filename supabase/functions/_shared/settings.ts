// Changeable settings stored in public.app_settings (written by admin-api). Falls back to env secrets.
import { admin } from "./db.ts";

let cache: { at: number; open: boolean } | null = null;

/** bidding_open from app_settings when the row exists, else the BIDDING_OPEN secret. Cached 10 s per isolate. */
export async function biddingOpenNow(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 10_000) return cache.open;
  let open = (Deno.env.get("BIDDING_OPEN") ?? "").toLowerCase() === "true";
  try {
    const r = await admin().from("app_settings").select("value").eq("key", "bidding_open").maybeSingle();
    if (!r.error && r.data && typeof r.data.value === "boolean") open = r.data.value;
  } catch (err) {
    console.error("settings: bidding_open read failed, using env", err);
  }
  cache = { at: Date.now(), open };
  return open;
}
