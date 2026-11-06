import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "../components/brand";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <main className="policy-page" id="main-content">
      <nav className="policy-nav">
        <Link href="/" aria-label="MotionWren home"><Wordmark size={26} /></Link>
        <Link className="text-btn" href="/">Back to home</Link>
      </nav>
      <article className="policy-body">
        <span className="eyebrow">TERMS</span>
        <h1>Terms of Service</h1>
        <p className="policy-date">Last updated November 6, 2026</p>
        <section>
          <h2>Who we are</h2>
          <p>MotionWren is a property-video service operated from Boston, Massachusetts, United States. Contact us at <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>. The legal entity name and registration details are being finalised and will be added here when confirmed.</p>
        </section>
        <section>
          <h2>Who can use MotionWren</h2>
          <p>You must be at least 18 years old to create an account or use the service. By creating an account you confirm that you are 18 or older and that you agree to these terms and to our <Link href="/privacy">Privacy Policy</Link>.</p>
        </section>
        <section>
          <h2>Customer rights and responsibility</h2>
          <p>You must own or have permission to use every photograph, logo, voice, music track and other asset you upload. You remain responsible for the accuracy and lawful use of the finished video.</p>
        </section>
        <section>
          <h2>Real-estate accuracy</h2>
          <p>The service must not be used to materially misrepresent a property. Customers must review every video before publication and must not present invented, removed or altered property features as factual.</p>
        </section>
        <section>
          <h2>Generated output</h2>
          <p>AI generation is probabilistic. Exact results are not guaranteed, and outputs may require regeneration or human review. A generation that completes technically is not automatically suitable for publication.</p>
        </section>
        <section>
          <h2>Prohibited use</h2>
          <p>Do not upload unlawful, infringing, deceptive, sexually exploitative or non-consensual material. Do not use the service to impersonate people, misrepresent listings or create unauthorized voice or likeness reproductions.</p>
        </section>
        <section>
          <h2>Payments and credits</h2>
          <p>Single video: $29 for one video. Five-pack: $125 for five video credits. Pro: $199 per month for ten credits each month. The price shown at checkout is the total you pay; any applicable tax is shown before you pay. Provider failures must not result in duplicate customer charges. If a generation fails, the credit used for it is automatically returned to your account. Single and five-pack credits do not expire while your account is active; Pro credits expire at the end of each billing month and do not roll over. You can cancel Pro at any time; access continues until the end of the billing period already paid for. Full details are in our <Link href="/refund">Refund Policy</Link>.</p>
        </section>
        <section>
          <h2>Availability</h2>
          <p>Generation depends on third-party infrastructure and may occasionally be delayed or unavailable. We may retry, route or pause work to protect quality and system stability.</p>
        </section>
        <section>
          <h2>Governing law</h2>
          <p>These terms are governed by the laws of Massachusetts, United States. Any dispute arising from the service will be handled under those laws.</p>
        </section>
        <section>
          <h2>Changes to these terms</h2>
          <p>We may update these terms when the service changes. The “Last updated” date above shows the current version. If a change materially affects your rights, we will tell you in the service or by email before it takes effect.</p>
        </section>
        <p className="policy-note">These terms were updated on November 6, 2026. They still require review by a lawyer before the first paid public launch, and the legal entity name and registration details are still to be added. Contact: MotionWren, Boston, Massachusetts — <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>.</p>
      </article>
    </main>
  );
}
