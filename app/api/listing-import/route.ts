import { audit, enforceRateLimit, jsonError, requireAccount } from "../_lib/account";

const MAX_HTML_BYTES = 2 * 1024 * 1024;

function safeListingUrl(value: unknown) {
  if (typeof value !== "string" || value.trim().length > 1800) throw new Error("Paste a valid public listing link.");
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Paste a public http or https listing link.");
  if (url.port && !['80', '443'].includes(url.port)) throw new Error("That listing link uses an unsupported port.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.includes(":") || /\.(local|internal|home|lan|localhost)$/.test(host) || host === "metadata.google.internal") throw new Error("Paste a public listing page, not a private network address.");
  return url;
}

async function fetchListing(start: URL) {
  let current = start;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    current = safeListingUrl(current.href);
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(12000), headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "FrameMotionStudio-ListingImporter/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The listing page redirected without a destination.");
      current = safeListingUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error("The listing website did not allow us to read that page.");
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) throw new Error("That link is not a public listing webpage.");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_HTML_BYTES) throw new Error("That listing page is too large to import safely.");
    if (!response.body) return { html: await response.text(), url: current };
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) { await reader.cancel(); throw new Error("That listing page is too large to import safely."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { html: new TextDecoder().decode(bytes), url: current };
  }
  throw new Error("The listing page redirected too many times.");
}

function decode(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).trim();
}

function metaMap(html: string) {
  const result = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) attrs.set(match[1].toLowerCase(), decode(match[2]));
    const key = attrs.get("property") || attrs.get("name") || attrs.get("itemprop");
    const content = attrs.get("content");
    if (key && content && !result.has(key.toLowerCase())) result.set(key.toLowerCase(), content);
  }
  return result;
}

function objectsFromJsonLd(html: string) {
  const objects: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>; objects.push(object);
    if (object["@graph"]) visit(object["@graph"]);
    for (const [key, child] of Object.entries(object)) if (key !== "@graph" && child && typeof child === "object") visit(child);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(decode(match[1]))); } catch { /* Ignore malformed third-party metadata. */ }
  }
  return objects;
}

function scalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return scalar(object.value ?? object.amount ?? object.name ?? "");
  }
  return "";
}

function first(objects: Record<string, unknown>[], keys: string[]) {
  for (const object of objects) for (const key of keys) { const value = scalar(object[key]); if (value) return value; }
  return "";
}

function address(objects: Record<string, unknown>[]) {
  for (const object of objects) {
    const value = object.address;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const street = scalar(item.streetAddress); const locality = scalar(item.addressLocality); const region = scalar(item.addressRegion); const postal = scalar(item.postalCode);
      const cityLine = [locality, region].filter(Boolean).join(", ");
      const formatted = [street, [cityLine, postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      if (formatted) return formatted;
    }
  }
  return "";
}

function digits(value: string) { return value.replace(/[^\d.]/g, "").replace(/\.(?=.*\.)/g, ""); }

function extractFields(html: string) {
  const objects = objectsFromJsonLd(html); const meta = metaMap(html);
  const titleTag = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const visible = decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).slice(0, 350000);
  const listingAddress = address(objects);
  const rawTitle = first(objects, ["name", "headline"]) || meta.get("og:title") || titleTag;
  const title = (listingAddress || rawTitle.split(/\s+[|–—]\s+/)[0]).slice(0, 120);
  const beds = digits(first(objects, ["numberOfBedrooms", "bedrooms"]) || visible.match(/(\d+(?:\.\d+)?)\s*(?:beds?|bedrooms?|bd)\b/i)?.[1] || "");
  const baths = digits(first(objects, ["numberOfBathroomsTotal", "numberOfBathrooms", "bathrooms"]) || visible.match(/(\d+(?:\.\d+)?)\s*(?:baths?|bathrooms?|ba)\b/i)?.[1] || "");
  const squareFeet = digits(first(objects, ["floorSize", "livingArea", "floorArea"]) || visible.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|square\s+feet)\b/i)?.[1] || "").split(".")[0];
  const price = digits(first(objects, ["price", "lowPrice"]) || meta.get("product:price:amount") || visible.match(/\$\s*([\d,]{4,})/)?.[1] || "").split(".")[0];
  return { title, listingAddress: listingAddress.slice(0, 240), beds: beds.slice(0, 12), baths: baths.slice(0, 12), squareFeet: squareFeet.slice(0, 20), price: price.slice(0, 30) };
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers"); const account = await requireAccount(env);
    await enforceRateLimit(env, account.id, "listing-import", 10, 60 * 60 * 1000);
    const body = await request.json() as { url?: unknown };
    let requested: URL;
    try { requested = safeListingUrl(body.url); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Paste a valid listing link." }, { status: 400 }); }
    let imported;
    try { imported = await fetchListing(requested); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The listing could not be imported.", fallback: true }, { status: 422 }); }
    const fields = extractFields(imported.html); const importedFields = Object.entries(fields).filter(([, value]) => Boolean(value)).map(([key]) => key);
    if (!importedFields.length) return Response.json({ error: "We opened the page, but it did not expose listing details. Continue manually and fill only what you need.", fallback: true }, { status: 422 });
    await audit(env, account.id, "listing.imported", "listing", undefined, { provider: imported.url.hostname, fields: importedFields });
    return Response.json({ sourceUrl: imported.url.href, provider: imported.url.hostname, fields, importedFields });
  } catch (error) { return jsonError(error); }
}
