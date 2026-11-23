"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type Hit = { key: string; title: string; hint: string; href: string; group: "Go to" | "Orders" | "Customers" };

/* Places in the manager, including the sections inside a page. The words are what the owner would type. */
const PLACES: Hit[] = [
  { title: "Overview", hint: "Business at a glance", href: "/admin", words: "home dashboard health pipeline retention cleanup system" },
  { title: "Orders", hint: "Every client order", href: "/admin/orders", words: "projects clients packages profit clean up test rows delete failed" },
  { title: "Production", hint: "Videos being made, problems", href: "/admin/production", words: "queue scenes stuck failed resume retry health" },
  { title: "Engines", hint: "Video engines and prices", href: "/admin/production#engines", words: "replicate wan hailuo kling model price speed" },
  { title: "Music tools", hint: "Samples and music check", href: "/admin/production#controls", words: "elevenlabs music samples test controls scenes at once" },
  { title: "Customers", hint: "Every account", href: "/admin/customers", words: "clients accounts users plan" },
  { title: "Gift codes", hint: "Give free videos", href: "/admin/customers", words: "gift code free videos promo credits" },
  { title: "Finance", hint: "Spending, costs and profit", href: "/admin/finance", words: "money cost profit revenue margin spend spending" },
  { title: "Pause all spending", hint: "Finance · spending guard", href: "/admin/finance", words: "stop pause limit budget daily monthly guard" },
  { title: "Spending limits", hint: "Finance · change limits", href: "/admin/finance", words: "budget alert daily monthly per film" },
  { title: "Video engine account", hint: "Finance · balance and low-balance reminder", href: "/admin/finance", words: "replicate balance top up billing reminder" },
  { title: "Studio", hint: "Make a video yourself", href: "/studio", words: "generate create film history edit" },
  { title: "Studio Ads", hint: "Ads, actors, subtitles", href: "/admin/studio-ads", words: "ad actors subtitles scenes sound" },
  { title: "Library Studio", hint: "Recorded templates and music library", href: "/admin/library-studio", words: "templates music library audit" },
  { title: "WrenCut", hint: "Turn a reference edit into a template", href: "/admin/wrencut", words: "reference template reel link upload" },
  { title: "Customer view", hint: "The client dashboard", href: "/dashboard", words: "client dashboard" },
].map((place) => ({ ...place, key: `go:${place.title}`, group: "Go to" as const }));

const norm = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9@. ]+/g, " ");

type Searchable = Hit & { words?: string };

/* The magnifier in the corner: type a few letters, pick a suggestion, land on it. */
export default function AdminSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [people, setPeople] = useState<Searchable[]>([]);
  const [orders, setOrders] = useState<Searchable[]>([]);
  const loaded = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Orders and customers are fetched the first time the search opens, so the page itself stays as light as before.
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    void fetch("/api/admin/customers", { cache: "no-store" }).then((response) => response.json()).then((data: { customers?: Array<{ email: string; displayName?: string; projectCount?: number }> }) => {
      setPeople((data.customers || []).map((customer) => ({ key: `c:${customer.email}`, group: "Customers" as const, title: customer.displayName || customer.email, hint: `${customer.email} · ${customer.projectCount ?? 0} orders`, href: `/admin/orders?customer=${encodeURIComponent(customer.email)}`, words: `${customer.email} ${customer.displayName || ""}` })));
    }).catch(() => { loaded.current = false; });
    void fetch("/api/admin/overview", { cache: "no-store" }).then((response) => response.json()).then((data: { recentProjects?: Array<Record<string, string | number | null>> }) => {
      setOrders((data.recentProjects || []).map((order) => ({ key: `o:${order.id}`, group: "Orders" as const, title: String(order.title || "Order"), hint: [order.listingAddress, order.ownerName || order.ownerEmail].filter(Boolean).join(" · ") || "Order", href: `/admin/projects/${String(order.id)}`, words: `${order.listingAddress || ""} ${order.ownerName || ""} ${order.ownerEmail || ""} ${order.title || ""}` })));
    }).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); }
      else if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const hits = useMemo(() => {
    const terms = norm(query).split(/\s+/).filter(Boolean);
    const places = PLACES as Searchable[];
    const pool = [...places, ...orders, ...people];
    if (!terms.length) return places.slice(0, 7);
    return pool.map((item) => {
      const title = norm(item.title); const all = `${title} ${norm(item.hint)} ${norm(item.words || "")}`;
      if (!terms.every((term) => all.includes(term))) return null;
      return { item, score: (terms.every((term) => title.startsWith(term) || title.includes(` ${term}`)) ? 0 : terms.every((term) => title.includes(term)) ? 1 : 2) + (item.group === "Go to" ? 0 : 0.5) };
    }).filter((row): row is { item: Searchable; score: number } => Boolean(row)).sort((a, b) => a.score - b.score).slice(0, 9).map((row) => row.item);
  }, [query, orders, people]);

  const go = (hit: Hit) => { setOpen(false); setQuery(""); router.push(hit.href); };
  const close = () => { setOpen(false); setQuery(""); setCursor(0); };

  return <>
    <button type="button" className="mgr-search-btn" aria-label="Search" title="Search (Ctrl K)" onClick={() => setOpen(true)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
    </button>
    {open && <div className="mgr-search" role="dialog" aria-modal="true" aria-label="Search" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="mgr-search-box">
        <input ref={input} value={query} placeholder="Find an order, a customer or a page" aria-label="Search" autoComplete="off"
          onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setCursor((value) => Math.min(hits.length - 1, value + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((value) => Math.max(0, value - 1)); }
            else if (event.key === "Enter" && hits[cursor]) { event.preventDefault(); go(hits[cursor]); }
          }} />
        <ul role="listbox">
          {hits.map((hit, index) => <li key={hit.key} role="option" aria-selected={index === cursor}>
            <button type="button" className={index === cursor ? "on" : ""} onMouseEnter={() => setCursor(index)} onClick={() => go(hit)}>
              <span><strong>{hit.title}</strong><small>{hit.hint}</small></span><em>{hit.group}</em>
            </button>
          </li>)}
          {!hits.length && <li className="empty">Nothing matches &ldquo;{query}&rdquo;</li>}
        </ul>
      </div>
    </div>}
  </>;
}
