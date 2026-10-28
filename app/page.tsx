import Link from "next/link";
import { redirect } from "next/navigation";
import { configuredAdmins, getGoogleSession } from "./api/_lib/account";
import { Wordmark } from "./components/brand";
import PropertyFilm from "./components/property-film";

export const dynamic = "force-dynamic";

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

  return <main className="site">
    <nav className="site-nav" aria-label="Main navigation">
      <div className="site-wrap site-nav-inner">
        <Link href="/" className="site-home" aria-label="MotionWren home"><Wordmark size={30} /></Link>
        <div className="site-links">
          <Link className="quiet" href="#how">How it works</Link>
          <Link className="quiet" href="#pricing">Pricing</Link>
          {session
            ? <a className="btn btn-ink btn-sm" href={accountPath} target="_top">Dashboard</a>
            : <><a className="sign-in-link" href={accountPath} target="_top">Sign in</a><a className="btn btn-ink btn-sm" href={accountPath} target="_top" data-mw="plan">Create video</a></>}
        </div>
      </div>
    </nav>

    <header className="hero site-wrap">
      <p className="eyebrow">Property video · For real estate agents</p>
      <h1>Listing photos,<br /><span>brought to life.</span></h1>
      <p className="hero-sub">Upload the photos you already have. Get a cinematic property video, ready to post.</p>
      <div className="hero-actions">
        <a className="btn btn-ink btn-lg" href={accountPath} target="_top" data-mw="plan">Create your video<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
        <Link className="btn btn-ghost btn-lg" href="#how">See how it works</Link>
      </div>
      <p className="hero-fine">No filming · No editing software</p>
    </header>

    <section className="hero-film site-wrap" aria-label="Sample property film">
      <PropertyFilm listing />
    </section>

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
        <figure className="reveal"><PropertyFilm format="wide" start={1} hud="label" interval={5200} label="Sample hero listing film, widescreen." /><figcaption>Hero film · 16:9</figcaption></figure>
        <figure className="reveal"><PropertyFilm format="tall" start={0} hud="label" interval={4400} label="Sample vertical reel." /><figcaption>Reel · 9:16</figcaption></figure>
        <figure className="reveal"><PropertyFilm format="square" start={2} hud="label" interval={6000} label="Sample square feed post." /><figcaption>Feed · 1:1</figcaption></figure>
      </div>
    </section>

    <section className="band site-wrap accuracy" aria-labelledby="accuracy-title">
      <div className="accuracy-copy">
        <p className="eyebrow">Property accuracy</p>
        <h2 id="accuracy-title">The camera moves.<br />The home stays true.</h2>
        <p className="band-sub left">Walls stay straight, furniture stays put and the light matches your photos.</p>
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
        <article className="plan reveal"><span className="plan-name">Single</span><p className="plan-price">$29</p><small className="plan-per">$29 per video</small><strong>One complete property video</strong><p>Up to 20 seconds in 1080p, with project history and delivery.</p><a className="btn btn-soft" href={accountPath} target="_top">Start one project</a></article>
        <article className="plan plan-featured reveal"><span className="plan-name">Five-pack</span><p className="plan-price">$125</p><small className="plan-per">$25 per video</small><strong>Five video credits</strong><p>For active agents and photographers managing several listings.</p><a className="btn btn-amber" href={accountPath} target="_top">Open your workspace</a></article>
        <article className="plan reveal"><span className="plan-name">Pro</span><p className="plan-price">$199<small>/month</small></p><small className="plan-per">$19.90 per video</small><strong>Ten credits each month</strong><p>Centralized production tracking and a lower per-video cost.</p><a className="btn btn-soft" href={accountPath} target="_top">View your account</a></article>
      </div>
    </section>

    <section className="closer site-wrap">
      <h2>Every listing<br />deserves a film.</h2>
      <a className="btn btn-ink btn-lg" href={accountPath} target="_top" data-mw="plan">Create your video</a>
      {!session && <p className="closer-fine">Already a member? <a className="sign-in-link" href={accountPath} target="_top">Sign in</a> · New here? <a href="/signin?mode=signup" target="_top">Create account</a></p>}
    </section>

    <footer className="site-footer">
      <div className="site-wrap site-footer-inner">
        <Wordmark size={22} />
        <span className="muted">© {new Date().getFullYear()} MotionWren</span>
        <div className="footer-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="mailto:info@redaphoto.com">Contact</a>{session ? <a href={accountPath} target="_top">Dashboard</a> : <a href={accountPath} target="_top">Sign in</a>}</div>
      </div>
    </footer>
  </main>;
}
