"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "./brand";

/* Homepage navigation. It floats, clear and white, over the full-bleed hero
   and settles onto the paper background once the hero has scrolled away. On
   phones the links fold into a menu button, with the wordmark centred. */
export default function SiteNav({ accountPath, signedIn }: { accountPath: string; signedIn: boolean }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const hero = document.querySelector<HTMLElement>(".cine");
      const limit = hero ? hero.offsetHeight - 80 : 40;
      setSolid(window.scrollY > limit);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = before; window.removeEventListener("keydown", onKey); };
  }, [open]);

  const close = () => setOpen(false);
  return <nav className={`site-nav cine-nav${solid ? " is-solid" : ""}${open ? " is-open" : ""}`} aria-label="Main navigation">
    <div className="site-wrap site-nav-inner">
      <button type="button" className="nav-menu" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((value) => !value)}>
        <span /><span />
      </button>
      <Link href="/" className="site-home" aria-label="MotionWren home" onClick={close}><Wordmark size={30} /></Link>
      <div className="site-links">
        <Link className="quiet" href="#how">How it works</Link>
        <Link className="quiet" href="#pricing">Pricing</Link>
        {signedIn
          ? <a className="btn btn-sm nav-cta" href={accountPath} target="_top">Dashboard</a>
          : <><a className="sign-in-link" href={accountPath} target="_top">Sign in</a><a className="btn btn-sm nav-cta" href={accountPath} target="_top" data-mw="plan">Create video</a></>}
      </div>
      <a className="nav-balance nav-signin-mobile" href={accountPath} target="_top">{signedIn ? "Dashboard" : "Sign in"}</a>
    </div>
    <div id="site-menu" className="nav-sheet" hidden={!open}>
      <div className="site-wrap nav-sheet-inner">
        <Link href="#how" onClick={close}>How it works</Link>
        <Link href="#pricing" onClick={close}>Pricing</Link>
        <a href={accountPath} target="_top" onClick={close}>{signedIn ? "Dashboard" : "Sign in"}</a>
        {!signedIn && <a className="btn btn-ink btn-lg nav-sheet-cta" href={accountPath} target="_top" data-mw="plan" onClick={close}>Create your video</a>}
      </div>
    </div>
  </nav>;
}
