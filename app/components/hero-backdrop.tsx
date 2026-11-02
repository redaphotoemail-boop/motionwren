"use client";

import { useEffect, useId, useRef, useState } from "react";
import { sceneLibrary } from "./scenes";

/* The homepage's full-bleed backdrop. Until real visuals arrive it plays the
   illustrated sample scenes; to swap in real media, drop files into
   public/hero/ and list them here — a video wins over photos, photos over the
   illustrated scenes. Photos get the same slow camera move as the scenes. */
export const HERO_VIDEO = ""; // e.g. "/hero/hero.mp4" (muted, loops)
export const HERO_POSTER = ""; // e.g. "/hero/hero-poster.jpg" (first frame, shown while the video loads)
export const HERO_PHOTOS: string[] = []; // e.g. ["/hero/exterior.jpg", "/hero/living.jpg", "/hero/kitchen.jpg"]

const MOVES = ["push", "pan", "pull"] as const;

export default function HeroBackdrop({ interval = 6500 }: { interval?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const count = HERO_PHOTOS.length || sceneLibrary.length;
  const [{ active, previous }, setReel] = useState({ active: 0, previous: -1 });
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.02 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (HERO_VIDEO || !visible || count < 2) return;
    const timer = window.setInterval(() => setReel((reel) => ({ active: (reel.active + 1) % count, previous: reel.active })), interval);
    return () => window.clearInterval(timer);
  }, [visible, interval, count]);

  if (HERO_VIDEO) {
    return <div ref={rootRef} className="cine-media" aria-hidden="true">
      <video className="cine-video" src={HERO_VIDEO} poster={HERO_POSTER || undefined} autoPlay muted loop playsInline preload="metadata" />
    </div>;
  }

  const state = (index: number) => index === active ? " on" : index === previous ? " off" : "";
  return <div ref={rootRef} className={`cine-media${visible ? " is-playing" : ""}`} aria-hidden="true">
    {HERO_PHOTOS.length
      ? HERO_PHOTOS.map((src, index) => <div key={src} className={`cine-frame move-${MOVES[index % MOVES.length]}${state(index)}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed decorative backdrop from /public */}
        <img src={src} alt="" decoding="async" fetchPriority={index === 0 ? "high" : "low"} />
      </div>)
      : sceneLibrary.map((item, index) => <div key={item.key} className={`cine-frame move-${item.move}${state(index)}`}>
        <item.Scene uid={`hero${uid}${index}`} />
      </div>)}
  </div>;
}
