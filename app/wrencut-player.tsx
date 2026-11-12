"use client";

/* A template's preview, full screen and with sound: music, effects and
   transitions as they will be in a film. Opens over the page; the close button
   (or Escape) returns to it. */

import { useEffect, useRef } from "react";

export function PreviewPlayer({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = previous; };
  }, [onClose]);
  function full() {
    const element = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!element) return;
    if (element.requestFullscreen) void element.requestFullscreen().catch(() => undefined);
    else element.webkitEnterFullscreen?.();
  }
  return (
    <div className="wc-player" role="dialog" aria-modal="true" aria-label={`${title} preview`}>
      <div className="wc-player-bar"><strong>{title}</strong><span><button type="button" onClick={full}>Full screen</button><button type="button" onClick={onClose}>Close</button></span></div>
      <video ref={video} src={src} controls autoPlay loop playsInline />
    </div>
  );
}
