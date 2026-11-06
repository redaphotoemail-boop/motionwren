import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "../components/brand";

export const metadata: Metadata = { title: "Accessibility" };

export default function AccessibilityPage() {
  return (
    <main className="policy-page" id="main-content">
      <nav className="policy-nav">
        <Link href="/" aria-label="MotionWren home"><Wordmark size={26} /></Link>
        <Link className="text-btn" href="/">Back to home</Link>
      </nav>
      <article className="policy-body">
        <span className="eyebrow">ACCESSIBILITY</span>
        <h1>Accessibility Statement</h1>
        <p className="policy-date">Last updated November 6, 2026</p>
        <section>
          <h2>Our aim</h2>
          <p>MotionWren aims to make its website and service usable by as many people as possible, including people who use assistive technology. Our aim is to meet the Web Content Accessibility Guidelines (WCAG) 2.2, level AA, across the public pages of this website and the customer workspace.</p>
        </section>
        <section>
          <h2>What is in place</h2>
          <ul>
            <li>A skip-to-content link on every page, so keyboard users can move straight to the main content.</li>
            <li>Visible keyboard focus on links, buttons and form fields, and a logical tab order.</li>
            <li>Text contrast that meets WCAG AA for body text, muted text and links.</li>
            <li>Meaningful text alternatives for informative images; decorative images are marked as decorative.</li>
            <li>Form fields with labels, and error messages that explain what went wrong and how to fix it.</li>
          </ul>
        </section>
        <section>
          <h2>Known limitations</h2>
          <p>Some parts of the service are harder to make fully accessible, and we are still working on them:</p>
          <ul>
            <li>Generated videos are visual by nature. A video&apos;s content is described by the photographs and directions the customer provided, and we do not currently provide audio descriptions or transcripts of generated videos.</li>
            <li>Some interactive previews and third-party sign-in screens are controlled by other providers and may not fully follow the same accessibility standards.</li>
            <li>Older project history and sample imagery may not yet have complete text alternatives.</li>
          </ul>
        </section>
        <section>
          <h2>Feedback and help</h2>
          <p>If you find an accessibility problem on MotionWren, or you need help using the service in another way, please contact us at <a href="mailto:info@redaphoto.com">info@redaphoto.com</a> and tell us which page or feature you had trouble with and what happened. We aim to answer within 3 business days and to fix reported problems where we reasonably can.</p>
        </section>
        <p className="policy-note">This statement describes our aim and the measures currently in place. It is not a legal guarantee of accessibility, and it will be updated as the service changes. Contact: MotionWren, Boston, Massachusetts — <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>.</p>
      </article>
    </main>
  );
}
