/* The opening property card and the closing agent card, drawn over a film.
   A cinematic title card: centered, a serif name over small spaced capitals,
   no boxes. The opening fades in over a soft vignette; the film ends by
   dimming to dark, the agent card appears on the dark, and everything fades
   to black on the last beat. */

export type OverlayBranding = {
  listingTitle: string; listingBeds: string; listingBaths: string; listingSquareFeet: string; listingPrice: string; listingMessage: string;
  agentName: string; agentEmail: string; agentPhone: string;
};

export const OVERLAY_SANS = `"SF Pro Text", "Helvetica Neue", Inter, "Segoe UI", Helvetica, Arial, sans-serif`;
export const OVERLAY_SERIF = `"Iowan Old Style", Baskerville, "Baskerville Old Face", "Palatino Linotype", Palatino, Georgia, serif`;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const x = clamp(value); return x * x * (3 - 2 * x); };
/* 0 → 1 over `fade` seconds starting at `start`. */
const rampIn = (time: number, start: number, fade: number) => smooth((time - start) / fade);

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

export function listingFactsText(branding: OverlayBranding) {
  return [
    branding.listingBeds.trim() && `${branding.listingBeds.trim()} ${branding.listingBeds.trim() === "1" ? "bed" : "beds"}`,
    branding.listingBaths.trim() && `${branding.listingBaths.trim()} ${branding.listingBaths.trim() === "1" ? "bath" : "baths"}`,
    branding.listingSquareFeet.trim() && `${branding.listingSquareFeet.trim()} sq ft`,
  ].filter(Boolean).join("   ·   ");
}

function setFont(context: Ctx, family: string, weight: number, size: number, spacing = 0) {
  context.font = `${weight} ${Math.round(size)}px ${family}`;
  context.letterSpacing = `${(spacing * size).toFixed(2)}px`;
}
/* The largest size (down to `min`) at which the text still fits `maxWidth`. */
function fit(context: Ctx, text: string, family: string, weight: number, maxWidth: number, start: number, min: number, spacing = 0) {
  let size = start;
  while (size > min) { setFont(context, family, weight, size, spacing); if (context.measureText(text).width <= maxWidth) break; size -= 2; }
  return size;
}
/* One centered line that fades in (rising a little) from `at` seconds. */
function line(context: Ctx, text: string, x: number, y: number, now: number, at: number, alpha: number, rise: number) {
  const progress = rampIn(now, at, 0.8);
  if (progress <= 0 || alpha <= 0) return;
  context.save(); context.globalAlpha = alpha * progress; context.textAlign = "center"; context.fillText(text, x, y + rise * (1 - progress)); context.restore();
}

type Row = { kind: "logo" | "eyebrow" | "title" | "rule" | "detail" | "note"; size: number; text?: string };

/* Lays the rows out as one block centered on the frame, then draws each with its own staggered entrance. */
function drawBlock(ctx: Ctx, rows: Row[], width: number, height: number, now: number, start: number, alpha: number, u: number, logo?: OverlayState["logo"]) {
  const gap = (row: Row) => row.kind === "eyebrow" ? 26 * u : row.kind === "title" ? 28 * u : row.kind === "rule" ? 30 * u : row.kind === "logo" ? 38 * u : row.kind === "detail" ? 22 * u : 14 * u;
  const total = rows.reduce((sum, row, index) => sum + row.size + (index < rows.length - 1 ? gap(row) : 0), 0);
  const centerX = width / 2; const maxWidth = width - 150 * u;
  let y = (height - total) / 2;
  rows.forEach((row, index) => {
    const at = start + index * 0.2; const progress = rampIn(now, at, 0.9); const rise = 12 * u;
    if (row.kind === "logo" && logo) {
      const scale = Math.min(row.size / logo.height, (maxWidth * 0.4) / logo.width); const w = logo.width * scale; const h = logo.height * scale;
      ctx.save(); ctx.globalAlpha = alpha * progress; ctx.drawImage(logo, centerX - w / 2, y + (row.size - h) / 2 + rise * (1 - progress), w, h); ctx.restore();
    } else if (row.kind === "rule") {
      ctx.save(); ctx.globalAlpha = alpha * progress * 0.6; ctx.fillStyle = "#ffffff"; ctx.fillRect(centerX - 24 * u * progress, y, 48 * u * progress, Math.max(1, row.size)); ctx.restore();
    } else if (row.kind === "title") {
      const size = fit(ctx, row.text!, OVERLAY_SERIF, 400, maxWidth, row.size, 30 * u);
      ctx.fillStyle = "#ffffff"; setFont(ctx, OVERLAY_SERIF, 400, size); line(ctx, row.text!, centerX, y + row.size * 0.8, now, at, alpha, rise);
    } else if (row.kind === "eyebrow") {
      ctx.fillStyle = "rgba(255,255,255,.66)"; setFont(ctx, OVERLAY_SANS, 400, row.size, 0.5); line(ctx, row.text!, centerX, y + row.size * 0.8, now, at, alpha, rise);
    } else if (row.kind === "detail") {
      const size = fit(ctx, row.text!, OVERLAY_SANS, 400, maxWidth, row.size, 11 * u, 0.3);
      ctx.fillStyle = "rgba(255,255,255,.82)"; setFont(ctx, OVERLAY_SANS, 400, size, 0.3); line(ctx, row.text!, centerX, y + row.size * 0.8, now, at, alpha, rise);
    } else {
      const size = fit(ctx, row.text!, OVERLAY_SANS, 400, maxWidth, row.size, 11 * u, 0.12);
      ctx.fillStyle = "rgba(255,255,255,.62)"; setFont(ctx, OVERLAY_SANS, 400, size, 0.12); line(ctx, row.text!, centerX, y + row.size * 0.8, now, at, alpha, rise);
    }
    y += row.size + gap(row);
  });
}

export type OverlayState = { logo?: CanvasImageSource & { width: number; height: number } | null };

/* Draws one frame's overlays on top of the already-drawn film frame. */
export function drawListingOverlays(context: CanvasRenderingContext2D, width: number, height: number, now: number, duration: number, branding: OverlayBranding, showOpening: boolean, showClosing: boolean, state: OverlayState = {}) {
  const ctx = context as Ctx;
  const u = width / (width >= height ? 1280 : 800); // one design unit
  ctx.textBaseline = "alphabetic";

  /* ---- opening: the property, centered ---- */
  if (showOpening) {
    const openStart = 0.5;
    const openEnd = Math.min(openStart + 4.2, Math.max(openStart + 2.4, duration * 0.5));
    const alpha = smooth((now - openStart) / 1.0) * smooth((openEnd - now) / 0.9);
    if (alpha > 0) {
      const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, Math.max(width, height) * 0.75);
      vignette.addColorStop(0, `rgba(0,0,0,${0.18 * alpha})`); vignette.addColorStop(1, `rgba(0,0,0,${0.62 * alpha})`);
      ctx.save(); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height); ctx.restore();
      const title = branding.listingTitle.trim(); const facts = listingFactsText(branding).toUpperCase(); const price = branding.listingPrice.trim().toUpperCase(); const message = branding.listingMessage.trim();
      const detail = [facts, price].filter(Boolean).join("   ·   ");
      const rows: Row[] = [];
      if (title) rows.push({ kind: "eyebrow", size: 14 * u, text: "NOW PRESENTING" }, { kind: "title", size: 64 * u, text: title });
      if (title && (detail || message)) rows.push({ kind: "rule", size: 1 * u });
      if (detail) rows.push({ kind: "detail", size: 15 * u, text: detail });
      if (message) rows.push({ kind: "note", size: 18 * u, text: message });
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 24 * u;
      drawBlock(ctx, rows, width, height, now, openStart + 0.1, alpha, u);
      ctx.restore();
    }
  }

  /* ---- ending: the film dims to dark, the agent card appears, all fades to black ---- */
  const closing = Math.min(duration * 0.45, showClosing ? 4.4 : 1);
  const closeStart = duration - closing;
  const endFade = rampIn(now, duration - 0.9, 0.9);
  const dim = showClosing ? rampIn(now, closeStart, 1.2) * 0.95 : 0;
  const dark = Math.max(dim, endFade);
  if (dark > 0) { ctx.save(); ctx.fillStyle = `rgba(6,6,7,${dark})`; ctx.fillRect(0, 0, width, height); ctx.restore(); }

  if (showClosing) {
    const name = branding.agentName.trim(); const phone = branding.agentPhone.trim(); const email = branding.agentEmail.trim(); const logo = state.logo;
    const alpha = 1 - endFade;
    const textStart = closeStart + 1.0;
    if (alpha > 0 && now > textStart) {
      const rows: Row[] = [];
      if (logo) rows.push({ kind: "logo", size: Math.min(height * 0.15, 110 * u) });
      if (name) rows.push({ kind: "eyebrow", size: 14 * u, text: "REPRESENTED BY" }, { kind: "title", size: 64 * u, text: name });
      if (name && (phone || email)) rows.push({ kind: "rule", size: 1 * u });
      const contact = [phone, email].filter(Boolean).join("     ");
      if (contact) rows.push({ kind: "note", size: 20 * u, text: contact });
      ctx.save(); ctx.shadowColor = "transparent";
      drawBlock(ctx, rows, width, height, now, textStart, alpha, u, logo);
      ctx.restore();
    }
  }
}
