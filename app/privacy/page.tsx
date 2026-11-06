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
          <p>Project files and finished videos are stored in private object storage. Temporary processing assets may be removed after production. We keep personal information only as long as we need it for the purpose it was collected for, and then we delete it or make it anonymous. In particular:</p>
          <ul>
            <li>Generation history entries expire after 90 days.</li>
            <li>Project files and finished videos are kept while your account is active and are deleted when you delete your account.</li>
            <li>Technical and security logs are kept only as long as needed for security, abuse prevention and support, and are then deleted.</li>
            <li>Billing and payment records are kept for as long as the law requires for tax and accounting purposes. We do not store card details on our servers — card payments are handled by Stripe.</li>
          </ul>
          <p>When we delete your account, your projects, photos, videos and credits are deleted as described in “Your choices” below. Copies may remain in backups for a short period until those backups are replaced, and billing records may be kept for the legal period above even after your account is deleted.</p>
        </section>
        <section>
          <h2>Security</h2>
          <p>We use authenticated access, private file storage, tenant-specific ownership checks and server-side processing. No internet service can guarantee absolute security. If we learn of a security incident affecting your personal information, we will tell you as the law requires.</p>
        </section>
        <section>
          <h2>How we handle a data-security incident</h2>
          <p>If we discover a security incident that affects your personal information, we will investigate it promptly, take steps to contain it and reduce any harm, and notify you without undue delay where the law requires us to do so — by email to the address on your account and, where appropriate, by a notice in the service. Our notice will explain, in plain language, what happened, what information was affected, what we are doing about it, and what you can do to protect yourself. We will also notify the relevant regulator where the law requires it. We do not publish internal security details, system configurations or investigation methods.</p>
        </section>
        <section>
          <h2>Your choices</h2>
          <p>You may request access, correction, export or deletion of your account information and project media. In your workspace, use the account menu: “Download my data” exports your data, and “Delete account” permanently deletes your account, projects, photos, videos and credits. Download your data first — deletion cannot be undone. You can also make any of these requests by emailing <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>.</p>
        </section>
        <section>
          <h2>Service providers</h2>
          <p>We share personal information only with the service providers we need to operate MotionWren. Each provider is bound by contract to process your information only on our instructions and only for the purpose we share it for. The providers we use are:</p>
          <ul>
            <li><b>Cloudflare</b> — hosting, storage and delivery of the service, including your account, projects, media and finished videos.</li>
            <li><b>Replicate</b> — video generation, receiving the photographs and generation directions needed to produce your video.</li>
            <li><b>OpenAI Sites</b> — processing support for generation, receiving media and generation directions as needed to complete your request.</li>
            <li><b>Stripe</b> — payments, receiving your billing details. Card details are handled by Stripe and are never stored on our servers.</li>
            <li><b>Google</b> — sign-in, receiving the identity information needed to create and access your account; and web fonts, which may receive your IP address and browser information when a page loads.</li>
            <li><b>Resend</b> — service email, receiving your name and email address to send account and service messages.</li>
          </ul>
          <p>We do not sell your personal information or your media, and we do not share them for advertising. A full list of the cookies and browser storage we use is in our <Link href="/cookies">Cookie Policy</Link>.</p>
        </section>
        <section>
          <h2>Your content and intellectual property</h2>
          <p>You keep the rights in the photographs and other material you upload. By uploading material, you give MotionWren a licence to store, process and transmit it, and to share it with the service providers listed above, solely to provide the service you requested. You are responsible for having the rights to everything you upload.</p>
          <p>If you believe material on MotionWren infringes your copyright, please contact us at <a href="mailto:info@redaphoto.com">info@redaphoto.com</a> with: identification of the work you say has been infringed; identification of the material you say is infringing and where it can be found; your contact details; and a statement that you believe in good faith that the use is not authorised. We will review the complaint and, where appropriate, remove or restrict access to the material. We may suspend or close the account of a user who repeatedly uploads infringing material.</p>
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
