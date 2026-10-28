// Validation for new listings. Pure functions, unit-testable.

export const CATEGORIES = ["Skincare & Beauty", "Snacks & Food", "Fashion", "Health & Fitness", "Home", "Startups"] as const;
export const CITIES = ["Mumbai", "Delhi NCR", "Bengaluru", "Hyderabad", "Pune", "Jaipur", "Other"] as const;

// Chat/invite links and URL shorteners are not allowed (rule 06).
const BLOCKED_HOSTS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "tiny.cc",
  "s.id", "lnkd.in", "linktr.ee", "wa.me", "chat.whatsapp.com", "api.whatsapp.com", "t.me", "telegram.me", "discord.gg",
  "discord.com", "chat.google.com", "m.me",
];
const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|yclid|_ga|ref|ref_src)$/i;

export interface NewListing {
  name: string; url: string; category: string; city: string;
  story: string | null; offer: string | null; discount_code: string | null;
  founder_name: string | null; founder_consent: boolean; rivalry_opt_in: boolean;
  business_details: string; contact_email: string;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
}

export function normaliseUrl(raw: string): { url?: string; error?: string } {
  let v = raw.trim();
  const ig = v.match(/^@([A-Za-z0-9._]{1,30})$/);
  if (ig) v = `https://www.instagram.com/${ig[1]}/`;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  let u: URL;
  try { u = new URL(v); } catch { return { error: "That doesn't look like a valid website or Instagram handle." }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Only http(s) links are allowed." };
  if (u.username || u.password) return { error: "Links with credentials aren't allowed." };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return { error: "Use your brand's real domain." };
  if (BLOCKED_HOSTS.some((b) => host === b || host.endsWith("." + b))) {
    return { error: "URL shorteners and chat or invite links aren't allowed. Use your brand website or Instagram." };
  }
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(k)) return { error: "Please remove tracking parameters (like utm_) from the link." };
  }
  u.hash = "";
  const out = u.toString();
  if (out.length > 300) return { error: "That link is too long." };
  return { url: out };
}

export function validateNewListing(input: unknown, email: unknown): { listing?: NewListing; errors: string[] } {
  const errors: string[] = [];
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = str(o.name, 60);
  if (!name || name.length < 2) errors.push("Brand name is required (2 to 60 characters).");
  const urlRaw = str(o.url, 400);
  let url: string | undefined;
  if (!urlRaw) errors.push("A brand website or Instagram handle is required.");
  else {
    const r = normaliseUrl(urlRaw);
    if (r.error) errors.push(r.error); else url = r.url;
  }
  const category = str(o.category, 40);
  if (!category || !(CATEGORIES as readonly string[]).includes(category)) errors.push("Pick a valid category.");
  const city = str(o.city, 40);
  if (!city || !(CITIES as readonly string[]).includes(city)) errors.push("Pick a valid city.");
  const story = str(o.story, 140);
  const offer = str(o.offer, 40);
  let code = str(o.discount_code, 20);
  if (code) {
    code = code.toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) errors.push("Discount code must be 3 to 20 letters or numbers.");
  }
  const founder_consent = o.founder_consent === true;
  let founder_name = str(o.founder_name, 60);
  if (founder_name && !founder_consent) errors.push("Founder names are shown only with the founder's consent. Tick the consent box or leave the name empty.");
  if (!founder_consent) founder_name = null;
  const business_details = str(o.business_details, 200);
  if (!business_details || business_details.length < 5) errors.push("GST number or company details are required.");
  const contact_email = str(email, 254)?.toLowerCase() ?? null;
  if (!contact_email || !EMAIL_RE.test(contact_email)) errors.push("A valid contact email is required.");
  if (errors.length) return { errors };
  return {
    errors,
    listing: {
      name: name!, url: url!, category: category!, city: city!, story, offer, discount_code: code,
      founder_name, founder_consent, rivalry_opt_in: o.rivalry_opt_in === true,
      business_details: business_details!, contact_email: contact_email!,
    },
  };
}
