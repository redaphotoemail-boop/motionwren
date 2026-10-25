import Link from "next/link";
import Image from "next/image";
import { Icon } from "./ui-icon";

const WrenMark = ({ compact = false }: { compact?: boolean }) => (
  <span className={compact ? "mw-logo compact" : "mw-logo"} aria-label="MotionWren">
    <Image src="/motionwren/motionwren-icon.png" alt="" aria-hidden="true" width={34} height={34} unoptimized />
    <strong>MotionWren</strong>
  </span>
);

export default function HomePage() {
  const accountPath = "/api/auth/google";

  return <main className="motionwren-site">
    <nav className="mw-nav" aria-label="Main navigation">
      <div className="mw-wrap">
        <Link href="/" className="mw-home"><WrenMark /></Link>
        <div className="mw-navlinks">
          <Link href="#how">How it works</Link>
          <Link href="#pricing">Pricing</Link>
          <a className="sign-in-link" href={accountPath} target="_top">Sign in</a>
          <a className="mw-button small" href={accountPath} target="_top">Create account</a>
        </div>
      </div>
    </nav>

    <header className="mw-hero mw-wrap">
      <p className="mw-eyebrow">PROPERTY VIDEO, SIMPLIFIED</p>
      <h1>Listing photos,<br /><em>brought to life.</em></h1>
      <p>Professional property videos made from the photos you already have—motion, pacing, branding and delivery included.</p>
      <div className="mw-actions">
        <a className="mw-button" href={accountPath} target="_top">Create your video <Icon name="arrow" size={16} /></a>
        <Link className="mw-button ghost" href="#how">See how it works</Link>
      </div>
      <small>No editing software. Your projects and finished files stay together in one workspace.</small>
    </header>

    <section className="mw-film mw-wrap" aria-label="MotionWren property video preview">
      <Image src="/og.png" alt="Preview of a finished MotionWren property film" width={1200} height={675} priority unoptimized />
      <div className="mw-film-shade" />
      <div className="mw-film-top"><span><i /> MOTIONWREN FILM</span><span>16:9 · 1080P</span></div>
      <div className="mw-film-card"><span>PROPERTY FILM</span><strong>Architecture stays true.<br />The camera does the moving.</strong><small>Camera-only motion · smooth pacing · polished delivery</small></div>
      <div className="mw-film-progress" />
    </section>

    <section id="how" className="mw-section mw-wrap mw-center">
      <p className="mw-eyebrow">HOW IT WORKS</p>
      <h2>Three clear steps.<br />No editing software.</h2>
      <div className="mw-steps">
        <article><span>01</span><Icon name="home" /><h3>Add the property</h3><p>Paste a listing link or enter the essentials yourself.</p></article>
        <article><span>02</span><Icon name="upload" /><h3>Upload your photos</h3><p>Put them in the order you want and choose the format.</p></article>
        <article><span>03</span><Icon name="finish" /><h3>Receive the film</h3><p>Track production, download the result and find it later.</p></article>
      </div>
    </section>

    <section className="mw-section mw-surface">
      <div className="mw-wrap mw-split">
        <div><p className="mw-eyebrow">PROPERTY ACCURACY</p><h2>Built for homes,<br />not random animation.</h2><p>The production system is designed around camera-only movement. Architecture, furniture, lighting and important listing details stay visually stable while the shot moves.</p></div>
        <div className="mw-quality">
          <article><Icon name="motion" /><span><strong>Purposeful motion</strong><small>Movement selected for the room and frame.</small></span></article>
          <article><Icon name="finish" /><span><strong>Professional assembly</strong><small>Multi-shot films use real crossfades and consistent pacing.</small></span></article>
          <article><Icon name="storage" /><span><strong>Durable delivery</strong><small>Originals and finished videos remain attached to your project.</small></span></article>
        </div>
      </div>
    </section>

    <section id="pricing" className="mw-section mw-wrap mw-center">
      <p className="mw-eyebrow">SIMPLE PRICING</p>
      <h2>Start with one property.<br />Scale when you need to.</h2>
      <div className="mw-pricing">
        <article><span>SINGLE</span><h3>$29</h3><strong>One complete property video</strong><p>Up to 20 seconds in 1080p, with project history and delivery.</p><a href={accountPath} target="_top">Start one project</a></article>
        <article className="featured"><span>FIVE-PACK</span><h3>$125</h3><strong>Five video credits</strong><p>For active agents and photographers managing several listings.</p><a href={accountPath} target="_top">Open your workspace</a></article>
        <article><span>PRO</span><h3>$199<small>/month</small></h3><strong>Ten credits each month</strong><p>Centralized production tracking and a lower per-video cost.</p><a href={accountPath} target="_top">View your account</a></article>
      </div>
    </section>

    <section className="mw-final">
      <div className="mw-wrap"><WrenMark compact /><h2>Your next property video starts with the images you already have.</h2><a className="mw-button amber" href={accountPath} target="_top">Create account</a></div>
    </section>

    <footer className="mw-footer"><div className="mw-wrap"><WrenMark compact /><span>© {new Date().getFullYear()} MotionWren</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/admin">Manager</Link><a href={accountPath} target="_top">Sign in</a></div></div></footer>
  </main>;
}
