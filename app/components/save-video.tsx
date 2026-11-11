"use client";

import { useState, type ReactNode } from "react";

// On phones, a plain download lands in the Files app, which then hands the
// video to another app. Sharing the file instead opens the system sheet, where
// "Save Video" puts it straight into Photos (iPhone) or Gallery (Android).
// Anywhere sharing files is not supported (most desktops), this stays an
// ordinary download link, so nothing changes there.
type Props = { href: string; fileName: string; className?: string; children?: ReactNode; downloadAttr?: boolean };

function canShareFile(file: File) {
  try {
    return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && typeof navigator.share === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export default function SaveVideo({ href, fileName, className, children, downloadAttr }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle");
  const [file, setFile] = useState<File | null>(null);
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  async function share(target: File) {
    try {
      await navigator.share({ files: [target], title: "MotionWren video" });
      setState("idle");
      setFile(null);
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "AbortError") { setState("idle"); setFile(null); return; }
      // The browser wants a fresh tap: keep the file and share on the next one.
      setFile(target);
      setState("ready");
    }
  }

  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!touch) return; // desktop: normal download
    if (file) { event.preventDefault(); await share(file); return; }
    if (state === "loading") { event.preventDefault(); return; }
    event.preventDefault();
    setState("loading");
    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error("fetch failed");
      const blob = await response.blob();
      const type = blob.type || "video/mp4";
      const made = new File([blob], fileName.replace(/\.[a-z0-9]+$/i, "") + (type.includes("webm") ? ".webm" : ".mp4"), { type });
      if (!canShareFile(made)) { setState("idle"); window.location.href = href.replace(/([?&])download=1&?/, "$1").replace(/[?&]$/, ""); return; }
      await share(made);
    } catch {
      // Could not prepare the file: open the video in the browser's own player.
      setState("idle");
      window.location.href = href.replace(/([?&])download=1&?/, "$1").replace(/[?&]$/, "");
    }
  }

  const label = state === "loading" ? "Preparing…" : state === "ready" ? "Tap to save" : children;
  return <a className={className} href={href} download={downloadAttr ? fileName : undefined} onClick={onClick} aria-busy={state === "loading"}>{label}</a>;
}
