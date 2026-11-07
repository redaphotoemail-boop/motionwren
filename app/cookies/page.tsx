import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "../components/brand";
import CookieSettings from "../components/cookie-settings";

export const metadata: Metadata = { title: "Cookie Policy" };

export default function CookiesPage() {
  return (
    <main className="policy-page" id="main-content">
      <nav className="policy-nav">
        <Link href="/" aria-label="MotionWren home"><Wordmark size={26} /></Link>
        <Link className="text-btn" href="/">Back to home</Link>
      </nav>
      <article className="policy-body">
        <span className="eyebrow">COOKIES</span>
        <h1>Cookie Policy</h1>
        <p className="policy-date">Last updated November 6, 2026</p>
        <section>
          <h2>What cookies are</h2>
          <p>Cookies are small files stored on your device. MotionWren also uses browser storage (local storage and IndexedDB) on your device to keep an unfinished order safe while you sign in. This page lists what we store and why.</p>
        </section>
        <section>
          <h2>Essential cookies — always on</h2>
          <p>These are needed for the service to work, and the service cannot work without them:</p>
          <p><strong>motionwren_session</strong> — keeps you signed in. It is HttpOnly, Secure and SameSite=Lax, and it lasts 7 days. It is set only after you sign in.</p>
          <p><strong>Google sign-in cookies</strong> — set by Google when you choose “Continue with Google”, to complete the sign-in. Google’s own cookie policy applies to those cookies.</p>
          <p><strong>Studio token cookie</strong> — in the owner-only Studio, a Replicate token may be stored in a private browser cookie so the Studio can generate. It is never shown again after it is saved.</p>
        </section>
        <section>
          <h2>Browser storage on your device</h2>
          <p>An unfinished order (your photos and answers) is saved in your browser’s IndexedDB so it survives signing in and is not lost if you refresh. It is stored on your device, not on our servers, until you sign in and the order is submitted. Your cookie-consent choice is saved in your browser’s local storage so we do not ask you again.</p>
        </section>
        <section>
          <h2>Optional cookies — only with your consent</h2>
          <p>MotionWren does not currently use analytics, advertising, or tracking cookies. If we add any optional cookies in future, the cookie banner will ask you first, and they will only be set if you accept. Choosing “Reject” does not change how the service works.</p>
        </section>
        <section>
          <h2>Third-party content</h2>
          <p>Fonts are loaded from Google Fonts, and videos are generated through contracted providers (listed in our <Link href="/privacy">Privacy Policy</Link>). Loading those services may involve requests to those providers, but MotionWren does not set advertising cookies.</p>
        </section>
        <section>
          <h2>Your choice</h2>
          <p>You can change or withdraw your cookie choice at any time below, or by clearing cookies and storage in your browser settings. Withdrawing consent does not affect anything already done while consent was in place.</p>
          <CookieSettings />
        </section>
        <p className="policy-note">Contact: MotionWren, Boston, Massachusetts — <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>. See also our <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Service</Link>.</p>
      </article>
    </main>
  );
}
