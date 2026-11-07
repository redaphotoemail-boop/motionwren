"use client";

import { useEffect, useState } from "react";

export const COOKIE_CONSENT_KEY = "mw-cookie-consent";

/* Lets a visitor see and change the cookie choice stored on their device. */
export default function CookieSettings() {
  const [choice, setChoice] = useState<string | null>(null);

  useEffect(() => {
    /* Read after paint, not during the effect body. */
    const frame = requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(COOKIE_CONSENT_KEY);
        setChoice(stored ? JSON.parse(stored).choice ?? null : null);
      } catch {
        setChoice(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function changeChoice() {
    try {
      window.localStorage.removeItem(COOKIE_CONSENT_KEY);
    } catch {
      /* Storage unavailable; the banner will simply ask again. */
    }
    window.location.reload();
  }

  return (
    <p>
      Your current choice: <strong>{choice === "accepted" ? "Accepted optional cookies" : choice === "rejected" ? "Rejected optional cookies" : "No choice saved yet"}</strong>.{" "}
      <button type="button" className="text-btn" onClick={changeChoice}>
        Change my cookie choice
      </button>
    </p>
  );
}
