import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "../components/brand";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <main className="policy-page" id="main-content">
      <nav className="policy-nav">
        <Link href="/" aria-label="MotionWren home"><Wordmark size={26} /></Link>
        <Link className="text-btn" href="/">Back to home</Link>
      </nav>
      <article className="policy-body">
        <span className="eyebrow">PRIVACY</span>
        <h1>Privacy Policy</h1>
        <p className="policy-date">Last updated November 6, 2026</p>
        <section>
          <h2>Who we are</h2>
          <p>MotionWren is a property-video service operated from Boston, Massachusetts, United States. Contact us at <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>. The legal entity name and registration details are being finalised and will be added here when confirmed.</p>
        </section>
        <section>
          <h2>Information we process</h2>
          <p>We process account identity (name and email address), project and listing information, uploaded photographs and logos, generation directions, billing and usage records, technical logs, and the videos produced through the service. We collect only what is needed to provide the service; we do not ask for your phone number, address, or any other information we do not need.</p>
        </section>
        <section>
          <h2>Minimum age</h2>
          <p>MotionWren is for people aged 18 and over. You must be at least 18 years old to create an account. We do not knowingly collect personal information from anyone under 18.</p>
        </section>
        <section>
          <h2>How files are used</h2>
          <p>Uploaded media is used only to provide the requested video-production service, operate project history, prevent abuse and support the customer. Media may be transmitted to contracted generation and processing providers required to complete the requested work. We do not sell your personal information or your media, and we do not use them for advertising.</p>
        </section>
        <section>
          <h2>Storage and retention</h2>
          <p>Project files and finished videos are stored in private object storage. Temporary processing assets may be removed after production. Generation history entries expire after 90 days. Project files are kept while your account is active and are deleted when you delete your account. Billing records are kept as long as the law requires for tax and accounting.</p>
        </section>
        <section>
          <h2>Security</h2>
          <p>We use authenticated access, private file storage, tenant-specific ownership checks and server-side processing. No internet service can guarantee absolute security. If we learn of a security incident affecting your personal information, we will tell you as the law requires.</p>
        </section>
        <section>
          <h2>Your choices</h2>
          <p>You may request access, correction, export or deletion of your account information and project media. In your workspace, use the account menu: “Download my data” exports your data, and “Delete account” permanently deletes your account, projects, photos, videos and credits. Download your data first — deletion cannot be undone. You can also make any of these requests by emailing <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>.</p>
        </section>
        <section>
          <h2>Service providers</h2>
          <p>Infrastructure and processing providers may include Cloudflare (hosting and storage), Replicate (video generation), OpenAI Sites, Stripe (payments — card details are handled by Stripe and are never stored on our servers), Google (sign-in and fonts), and Resend (service email). Their processing is limited to operating the service and completing requested generations. A full list of the cookies and browser storage we use is in our <Link href="/cookies">Cookie Policy</Link>.</p>
        </section>
        <section>
          <h2>Changes to this policy</h2>
          <p>We may update this policy when the service changes. The “Last updated” date above shows the current version. If a change materially affects how we handle your information, we will tell you in the service or by email before it takes effect.</p>
        </section>
        <p className="policy-note">This policy was updated on November 6, 2026. It still requires review by a lawyer before the first paid public launch, and the legal entity name and registration details are still to be added. Contact: MotionWren, Boston, Massachusetts — <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>.</p>
      </article>
    </main>
  );
}
