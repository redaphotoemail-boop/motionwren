"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { COOKIE_CONSENT_KEY } from "./cookie-settings";

/* Consent banner for optional cookies. Essential sign-in cookies are not
   optional, so rejecting changes nothing about how the service works.
   MotionWren currently sets no analytics or advertising cookies; the banner
   records the choice so any future optional cookie asks first. */
export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    /* Read after paint, not during the effect body, so the first render
       matches the server and the banner does not flash on every load. */
    const frame = requestAnimationFrame(() => {
      try {
        if (!window.localStorage.getItem(COOKIE_CONSENT_KEY)) setVisible(true);
      } catch {
        setVisible(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function choose(choice: "accepted" | "rejected") {
    try {
      window.localStorage.setItem(
        COOKIE_CONSENT_KEY,
        JSON.stringify({ choice, at: new Date().toISOString() }),
      );
    } catch {
      /* Storage unavailable; the choice simply is not remembered. */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="cookie-banner" role="region" aria-label="Cookie consent">
      <p>
        We use essential cookies to keep you signed in. We do not use analytics or advertising cookies.
        Read our <Link href="/cookies">Cookie Policy</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <div className="cookie-banner-actions">
        <button type="button" className="btn btn-ink btn-sm" onClick={() => choose("accepted")}>
          Accept
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => choose("rejected")}>
          Reject optional cookies
        </button>
      </div>
    </div>
  );
}
