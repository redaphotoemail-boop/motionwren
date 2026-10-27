"use client";

import { useEffect, useId, useRef, useState } from "react";
import { sceneLibrary } from "./scenes";

type FilmProps = {
  format?: "wide" | "tall" | "square";
  start?: number;
  hud?: "full" | "label" | "none";
  listing?: boolean;
  guides?: boolean;
  interval?: number;
  className?: string;
  label?: string;
};

const listingCard = { address: "42 Harbor Lane, Hingham MA", price: "$1,295,000", spec: "4 BD · 3 BA · 2,840 SQ FT" };

function timecode(ms: number) {
  const frames = Math.floor((ms / 1000) * 24);
  const f = frames % 24;
  const s = Math.floor(frames / 24) % 60;
  const m = Math.floor(frames / 24 / 60) % 60;
  return `00:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

/* A looping, illustrated property film: scenes cross-dissolve with a slow
   camera move, like the finished videos MotionWren delivers. */
export default function PropertyFilm({ format = "wide", start = 0, hud = "full", listing = false, guides = false, interval = 4800, className = "", label }: FilmProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [{ active, previous, cycle }, setReel] = useState({ active: start % sceneLibrary.length, previous: -1, cycle: 0 });
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => {
      setReel((reel) => ({ active: (reel.active + 1) % sceneLibrary.length, previous: reel.active, cycle: reel.cycle + 1 }));
    }, interval);
    return () => window.clearInterval(timer);
  }, [visible, interval]);

  useEffect(() => {
    if (hud !== "full" || !visible) return;
    let frame = 0;
    const began = performance.now() - start * 1700;
    const tick = (now: number) => {
      if (codeRef.current) codeRef.current.textContent = timecode(now - began);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hud, visible, start]);

  const scene = sceneLibrary[active];
  return (
    <div ref={rootRef} className={`film film-${format} ${visible ? "is-playing" : ""} ${className}`.trim()} role="img" aria-label={label || "Sample property film: an exterior at dusk, a living room and a kitchen, with gentle camera movement."}>
      {sceneLibrary.map((item, index) => (
        <div key={item.key} className={`film-frame move-${item.move}${index === active ? " on" : index === previous ? " off" : ""}`}>
          <item.Scene uid={`${uid}${index}`} />
        </div>
      ))}
      {guides && <div className="film-guides" aria-hidden="true"><i /><i /><i /><span /></div>}
      {hud !== "none" && (
        <div className="film-hud" aria-hidden="true">
          <div className="film-hud-top">
            <span className="film-rec"><i />{scene.label}</span>
            {hud === "full" && <span ref={codeRef}>00:00:00:00</span>}
          </div>
          {listing && (
            <div className="film-card">
              <strong>{listingCard.address}</strong>
              <b>{listingCard.price}</b>
              <small>{listingCard.spec}</small>
            </div>
          )}
        </div>
      )}
      {hud === "full" && <div className="film-progress" key={cycle} style={{ animationDuration: `${interval}ms` }} aria-hidden="true" />}
    </div>
  );
}
