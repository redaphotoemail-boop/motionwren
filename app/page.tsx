import { HOME_STAGES } from "./pipeline-steps";
import { BASE_CENTS, BASE_SECONDS, FIVE_PACK_CENTS, LONG_CENTS, LONG_SECONDS, MEMBER_FILMS, MEMBER_FILM_SECONDS, MEMBER_MONTHLY_CENTS, PRO_CREDITS, PRO_MONTHLY_CENTS, dollars, minPhotosFor, priceForSeconds } from "./pricing";
import Link from "next/link";
import { redirect } from "next/navigation";
import { configuredAdmins, getGoogleSession } from "./api/_lib/account";
import { Wordmark } from "./components/brand";
import HeroBackdrop from "./components/hero-backdrop";
import PropertyFilm from "./components/property-film";
import SiteNav from "./components/site-nav";

export const dynamic = "force-dynamic";

export const metadata = { alternates: { canonical: "/" } };

/* What search engines and AI search read about MotionWren: who runs it and what it sells, with the prices from pricing.ts. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": "https://motionwren.com/#org", name: "MotionWren", url: "https://motionwren.com", logo: "https://motionwren.com/apple-touch-icon.png" },
    {
      "@type": "Service", name: "Property videos from listing photos", serviceType: "Real estate video production", provider: { "@id": "https://motionwren.com/#org" }, areaServed: "US",
      offers: [
        ...[BASE_SECONDS, LONG_SECONDS].map((seconds) => ({ "@type": "Offer", name: `Listing film up to ${seconds} seconds`, price: (priceForSeconds(seconds) / 100).toFixed(2), priceCurrency: "USD" })),
        { "@type": "Offer", name: `Membership: ${MEMBER_FILMS} films a month, up to ${MEMBER_FILM_SECONDS} seconds each`, price: (MEMBER_MONTHLY_CENTS / 100).toFixed(2), priceCurrency: "USD" },
      ],
    },
  ],
};

const steps = [
  { n: "01", title: "Answer four questions", text: "Goal, property, channels, feel.", visual: "questions" },
  { n: "02", title: "Drop in your photos", text: "Two to twenty. The ones you already have.", visual: "photos" },
  { n: "03", title: "Get your content", text: "Every piece, sized and ready to post.", visual: "film" },
] as const;

function StepVisual({ kind }: { kind: (typeof steps)[number]["visual"] }) {
  if (kind === "questions") {
    return <div className="step-visual step-questions" aria-hidden="true">
      <span className="chip on">Sell faster</span><span className="chip">Single family</span>
      <span className="chip on">Instagram</span><span className="chip">MLS</span><span className="chip on">Warm</span>
    </div>;
  }
  if (kind === "photos") {
    return <div className="step-visual step-photos" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <i key={index} className={`tone-${index % 3}`} />)}
      <b>+</b>
    </div>;
  }
  return <div className="step-visual step-film" aria-hidden="true">
    <div className="mini-film"><span /><i /></div>
    <div className="mini-reel" />
    <div className="mini-square" />
  </div>;
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<{ owner?: string }> }) {
  // A Google sign-in that did not finish returns here; send people back to sign-in with a note.
  if ((await searchParams)?.owner === "restricted") redirect("/signin?google=failed");
  const { env } = await import("cloudflare:workers");
  const session = await getGoogleSession(env);
  const accountPath = session ? (configuredAdmins(env).has(session.email.toLowerCase()) ? "/admin" : "/dashboard") : "/signin";

  return <main className="site" id="main-content">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
    <SiteNav accountPath={accountPath} signedIn={Boolean(session)} />

    {/* Full-bleed hero: the listing itself fills the first screen, in motion. */}
    <header className="cine">
      <HeroBackdrop />
      <div className="cine-shade" aria-hidden="true" />
      <div className="cine-content site-wrap">
        <h1>Listing photos,<br />brought to life.</h1>
        <p className="cine-sub">Upload the photos you already have. Get a cinematic property video, ready to post.</p>
        <a className="btn btn-lg cine-cta" href={accountPath} target="_top" data-mw="plan">Create your video<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
        <ul className="cine-facts" aria-label="Highlights">
          <li>No filming</li>
          <li>No editing software</li>
          <li>Ready to post</li>
        </ul>
      </div>
    </header>

    <section id="how" className="band site-wrap">
      <div className="band-head">
        <p className="eyebrow">How it works</p>
        <h2>Three clear steps.<br />No editing software.</h2>
      </div>
      <ol className="steps">
        {steps.map((step) => <li key={step.n} className="reveal">
          <StepVisual kind={step.visual} />
          <span className="step-n">{step.n}</span>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </li>)}
      </ol>
    </section>

    <section className="band site-wrap" aria-labelledby="formats-title">
      <div className="band-head">
        <p className="eyebrow">One upload</p>
        <h2 id="formats-title">Every channel.<br />One upload.</h2>
        <p className="band-sub">A hero film for the listing. A reel for social. A square for the feed.</p>
      </div>
      <div className="formats">
        <figure className="reveal"><PropertyFilm format="wide" start={1} hud="label" listing interval={5200} label="Sample hero listing film, widescreen, with the listing's address, price and size on screen." /><figcaption>Hero film · 16:9</figcaption></figure>
        <figure className="reveal"><PropertyFilm format="tall" start={0} hud="label" interval={4400} label="Sample vertical reel." /><figcaption>Reel · 9:16</figcaption></figure>
        <figure className="reveal"><PropertyFilm format="square" start={2} hud="label" interval={6000} label="Sample square feed post." /><figcaption>Feed · 1:1</figcaption></figure>
      </div>
    </section>

    <section id="care" className="band site-wrap care" aria-labelledby="care-title">
      <div className="band-head">
        <p className="eyebrow">Why it&apos;s different</p>
        <h2 id="care-title">Not just generated.<br />Directed.</h2>
      </div>
      <div className="care-compare">
        <div className="care-row care-plain"><span className="care-tag">A typical AI video</span><div className="care-track" aria-hidden="true"><i /><b /></div><span className="care-note">One click. One guess.</span></div>
        <div className="care-row care-ours"><span className="care-tag">MotionWren</span>
          <ol className="care-track">
            {HOME_STAGES.map((stage, index) => <li key={stage.title} className="reveal"><i aria-hidden="true">{index + 1}</i><strong>{stage.title}</strong><span>{stage.line}</span></li>)}
          </ol>
        </div>
      </div>
    </section>

    <section className="band site-wrap accuracy" aria-labelledby="accuracy-title">
      <div className="accuracy-copy">
        <p className="eyebrow">Property accuracy</p>
        <h2 id="accuracy-title">The camera moves.<br />The home stays true.</h2>
        <p className="band-sub left">Designed to keep walls straight, furniture in place and the light matched to your photos — as far as the footage allows.</p>
        <p className="muted">Videos are generated by AI and can contain errors — always review your film in full before publishing it to a listing. If a film changes your property, we remake it or return your credit. <Link href="/refund">See the refund policy</Link> · <Link href="/terms">Read the terms</Link>.</p>
        <ul className="facts">
          <li><b>Camera-only motion</b><span>Movement chosen for each room.</span></li>
          <li><b>Real crossfades</b><span>Smooth pacing from scene to scene.</span></li>
          <li><b>Saved to your workspace</b><span>Download any time, find it later.</span></li>
        </ul>
      </div>
      <div className="accuracy-visual reveal"><PropertyFilm format="square" start={1} hud="none" guides interval={6400} label="A living room shot with guide lines showing the architecture staying straight while the camera moves." /></div>
    </section>

    <section id="pricing" className="band site-wrap" aria-labelledby="pricing-title">
      <div className="band-head">
        <p className="eyebrow">Simple pricing</p>
        <h2 id="pricing-title">Start with one property.<br />Scale when you need to.</h2>
      </div>
      <div className="plans">
        <article className="plan reveal"><span className="plan-name">Reel</span><p className="plan-price">{dollars(BASE_CENTS)}</p><small className="plan-per">Up to {BASE_SECONDS} seconds</small><strong>One property video</strong><p>{`From ${minPhotosFor(BASE_SECONDS)} photos, in 1080p, sized for every channel.`}</p><a className="btn btn-soft" href={accountPath} target="_top" data-mw="plan">Start one project</a></article>
        <article className="plan reveal"><span className="plan-name">Listing film</span><p className="plan-price">{dollars(LONG_CENTS)}</p><small className="plan-per">Up to {LONG_SECONDS} seconds</small><strong>The full walkthrough</strong><p>{`From ${minPhotosFor(LONG_SECONDS)} photos, in 1080p, sized for every channel.`}</p><a className="btn btn-soft" href={accountPath} target="_top">Start one project</a></article>
        <article className="plan plan-featured reveal"><span className="plan-name">Membership</span><p className="plan-price">{dollars(MEMBER_MONTHLY_CENTS)}<small>/month</small></p><small className="plan-per">{MEMBER_FILMS} films a month</small><strong>{`Up to ${MEMBER_FILM_SECONDS} seconds each`}</strong><p>For agents with a new listing every week. Cancel anytime.</p><a className="btn btn-amber" href={accountPath} target="_top">Become a member</a></article>
      </div>
      <p className="plans-note muted">{`Also: five ${BASE_SECONDS}-second films for ${dollars(FIVE_PACK_CENTS)}, or Pro: ${PRO_CREDITS} ${BASE_SECONDS}-second films a month for ${dollars(PRO_MONTHLY_CENTS)}. A longer film pays only the difference.`}</p>
    </section>

    <section className="closer site-wrap">
      <h2>Every listing<br />deserves a film.</h2>
      <a className="btn btn-ink btn-lg" href={accountPath} target="_top" data-mw="plan">Create your video</a>
      {!session && <p className="closer-fine">Already a member? <a className="sign-in-link" href={accountPath} target="_top">Sign in</a> · New here? <a href="/signin?mode=signup" target="_top">Create account</a></p>}
    </section>

    <footer className="site-footer">
      <div className="site-wrap site-footer-inner">
        <Wordmark size={22} />
        <span className="muted">© {new Date().getFullYear()} MotionWren · Boston, Massachusetts</span>
        <div className="footer-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/refund">Refunds</Link><Link href="/cookies">Cookies</Link><Link href="/accessibility">Accessibility</Link><a href="mailto:info@redaphoto.com">Contact</a>{session ? <a href={accountPath} target="_top">Dashboard</a> : <a href={accountPath} target="_top">Sign in</a>}</div>
      </div>
    </footer>
  </main>;
}
