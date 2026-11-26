"use client";

import { useEffect, useRef, useState } from "react";

/* Payment on MotionWren's own page (Rm, Nov 26 2026: no separate Stripe page; the
   same coherent page, in the same style and design). Stripe's Payment Element
   sits inside our own sheet and is styled with the site's colours and type.

   The order and its rules don't change: the server builds the same Checkout
   Session (same films, prices, credits used first, same metadata) and the
   Stripe webhook is still the only thing that starts a film, once Stripe says
   the money arrived. This sheet only collects the card.

   When the page can't show the form (no publishable key set yet, or Stripe.js
   couldn't load), it falls back to Stripe's own page, exactly as before. */

type Film = { projectId: string; seconds: number; cents: number };
type Props = {
  projectIds: string[];
  titles?: Record<string, string>; // project id -> "Hero listing film"
  onClose: () => void; // closed without paying: the order stays saved
  onPaid: () => void; // Stripe confirmed the card; the webhook starts the films
  onNothingDue?: () => void; // credits now cover everything
};

/* The Stripe.js surface we use (loaded from js.stripe.com, never bundled). */
type CheckoutActions = { confirm: (options?: { redirect?: "if_required" | "always" }) => Promise<{ type: "success" | "error"; error?: { message?: string } }> };
type StripeCheckout = {
  createPaymentElement: (options?: Record<string, unknown>) => { mount: (el: HTMLElement) => void; destroy?: () => void; on?: (event: string, handler: (event: { complete?: boolean }) => void) => void };
  loadActions?: () => Promise<{ type: string; actions?: CheckoutActions; error?: { message?: string } }>;
  confirm?: CheckoutActions["confirm"];
};
type StripeInstance = { initCheckoutElementsSdk?: (options: Record<string, unknown>) => StripeCheckout; initCheckout?: (options: Record<string, unknown>) => StripeCheckout };
type StripeFactory = (key: string) => StripeInstance;

const STRIPE_JS = "https://js.stripe.com/endive/stripe.js";
let stripeScript: Promise<StripeFactory> | null = null;
function loadStripeJs(): Promise<StripeFactory> {
  const existing = (window as unknown as { Stripe?: StripeFactory }).Stripe;
  if (existing) return Promise.resolve(existing);
  if (stripeScript) return stripeScript;
  stripeScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = STRIPE_JS;
    script.async = true;
    script.onload = () => {
      const factory = (window as unknown as { Stripe?: StripeFactory }).Stripe;
      if (factory) resolve(factory); else reject(new Error("Stripe.js did not load"));
    };
    script.onerror = () => { stripeScript = null; reject(new Error("Stripe.js did not load")); };
    document.head.appendChild(script);
  });
  return stripeScript;
}

/* The site's own look (app/globals.css tokens), so the form reads as part of the page. */
const APPEARANCE = {
  theme: "stripe",
  variables: {
    colorPrimary: "#14161A",
    colorBackground: "#FFFFFF",
    colorText: "#14161A",
    colorTextSecondary: "#61666E",
    colorTextPlaceholder: "#9A9EA5",
    colorDanger: "#C2412D",
    fontFamily: "Geist, -apple-system, 'Segoe UI', Roboto, sans-serif",
    fontSizeBase: "15px",
    borderRadius: "14px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "1px solid #E2E4DF", boxShadow: "none", padding: "13px 14px" },
    ".Input:focus": { border: "1px solid #14161A", boxShadow: "0 0 0 3px rgba(233, 162, 59, 0.22)" },
    ".Tab": { border: "1px solid #E2E4DF", boxShadow: "none" },
    ".Tab--selected": { border: "1px solid #14161A", boxShadow: "none" },
    ".Label": { fontWeight: "500", color: "#2A2D33" },
  },
};
const FONTS = [{ cssSrc: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" }];

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export default function PaySheet({ projectIds, titles, onClose, onPaid, onNothingDue }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const checkoutRef = useRef<StripeCheckout | null>(null);
  const [films, setFilms] = useState<Film[]>([]);
  const [due, setDue] = useState(0);
  const [stage, setStage] = useState<"loading" | "ready" | "paying" | "paid" | "error">("loading");
  const [error, setError] = useState("");
  const key = projectIds.join(",");

  async function stripePage() {
    // Stripe's own page, the way checkout worked before.
    setError(""); setStage("loading");
    try {
      const res = await fetch("/api/billing/film-checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectIds }) });
      const data = await res.json().catch(() => ({})) as { url?: string | null; due?: number; error?: string };
      if (res.ok && data.url) { window.location.assign(data.url); return; }
      if (res.ok && !data.due) { onNothingDue?.(); return; }
      setError(data.error || "Checkout could not be opened. Your order is saved; please try again."); setStage("error");
    } catch { setError("Couldn't reach MotionWren. Check your connection and try again."); setStage("error"); }
  }

  useEffect(() => {
    let cancelled = false;
    let element: { destroy?: () => void } | null = null;
    (async () => {
      try {
        const res = await fetch("/api/billing/film-checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectIds, embedded: true }) });
        const data = await res.json().catch(() => ({})) as { url?: string | null; clientSecret?: string; publishableKey?: string; due?: number; films?: Film[]; error?: string };
        if (cancelled) return;
        if (!res.ok) { setError(data.error || "Checkout could not be opened. Your order is saved; please try again."); setStage("error"); return; }
        if (data.url) { window.location.assign(data.url); return; } // no publishable key yet: Stripe's page, as before
        if (!data.clientSecret || !data.publishableKey) { onNothingDue?.(); return; }
        setFilms(data.films || []); setDue(Number(data.due) || 0);
        const Stripe = await loadStripeJs();
        if (cancelled) return;
        const stripe = Stripe(data.publishableKey);
        const init = stripe.initCheckoutElementsSdk || stripe.initCheckout;
        if (!init || !mountRef.current) throw new Error("Stripe checkout is unavailable");
        const checkout = init.call(stripe, { clientSecret: data.clientSecret, elementsOptions: { appearance: APPEARANCE, fonts: FONTS } });
        checkoutRef.current = checkout;
        const paymentElement = checkout.createPaymentElement({ layout: { type: "tabs" } });
        paymentElement.mount(mountRef.current);
        element = paymentElement;
        setStage("ready");
      } catch {
        if (cancelled) return;
        setError("The payment form couldn't load here."); setStage("error");
      }
    })();
    return () => { cancelled = true; try { element?.destroy?.(); } catch { /* already gone */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one checkout per set of films
  }, [key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && stage !== "paying" && stage !== "paid") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, onClose]);

  async function pay() {
    const checkout = checkoutRef.current;
    if (!checkout || stage === "paying") return;
    setStage("paying"); setError("");
    try {
      let confirm = checkout.confirm;
      if (checkout.loadActions) {
        const loaded = await checkout.loadActions();
        if (loaded.type !== "success" || !loaded.actions) throw new Error(loaded.error?.message || "");
        confirm = loaded.actions.confirm;
      }
      if (!confirm) throw new Error("");
      // Cards finish here; a bank page or Klarna sends the customer back to the dashboard (return_url).
      const result = await confirm({ redirect: "if_required" });
      if (result.type === "error") { setError(result.error?.message || "The payment didn't go through. Please check the details and try again."); setStage("ready"); return; }
      setStage("paid");
      onPaid();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The payment didn't go through. Please try again."); setStage("ready");
    }
  }

  const plural = films.length > 1 || projectIds.length > 1;
  return (
    <div className="pay" role="dialog" aria-modal="true" aria-labelledby="pay-title" onClick={(event) => { if (event.target === event.currentTarget && stage !== "paying" && stage !== "paid") onClose(); }}>
      <div className="pay-sheet">
        <div className="pay-head">
          <h2 id="pay-title">{stage === "paid" ? "Payment received" : plural ? "Start your films" : "Start your film"}</h2>
          {stage !== "paying" && stage !== "paid" && <button type="button" className="pay-x" aria-label="Close" onClick={onClose}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>}
        </div>

        {stage === "paid" ? <p className="pay-note">{plural ? "Your films are starting." : "Your film is starting."} You can close this page.</p> : <>
          {films.length > 0 && <ul className="pay-lines">
            {films.map((film) => <li key={film.projectId}><span>{titles?.[film.projectId] || "Film"}<small>{film.seconds} sec</small></span><b>{dollars(film.cents)}</b></li>)}
            {films.length > 1 && <li className="pay-total"><span>Total</span><b>{dollars(due)}</b></li>}
          </ul>}
          <div className={`pay-form${stage === "loading" ? " is-loading" : ""}`} ref={mountRef} aria-busy={stage === "loading"} />
          {stage === "loading" && <div className="pay-skeleton" aria-hidden="true"><i /><i /><i /></div>}
          {error && <p className="pay-error" role="alert">{error}</p>}
          {stage === "error"
            ? <button type="button" className="btn btn-ink btn-lg pay-btn" onClick={stripePage}>Pay on Stripe instead</button>
            : <button type="button" className="btn btn-ink btn-lg pay-btn" disabled={stage !== "ready"} onClick={pay}>{stage === "paying" ? "Paying…" : due ? `Pay ${dollars(due)}` : "Pay"}</button>}
          <p className="pay-fine">{plural ? "Your films start" : "Your film starts"} the moment payment clears. Secured by Stripe.</p>
        </>}
      </div>
    </div>
  );
}
