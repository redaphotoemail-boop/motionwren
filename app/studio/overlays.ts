/* The opening property card and the closing agent card, drawn over a film.
   One quiet, modern look: no boxes, light type, generous space. The opening
   text rises in over a soft shade; the film ends by dimming to dark, the agent
   details appear on the dark, and everything fades to black on the last beat. */

export type OverlayBranding = {
  listingTitle: string; listingBeds: string; listingBaths: string; listingSquareFeet: string; listingPrice: string; listingMessage: string;
  agentName: string; agentEmail: string; agentPhone: string;
};

export const OVERLAY_FONT = `"SF Pro Display", "Helvetica Neue", Inter, "Segoe UI", Helvetica, Arial, sans-serif`;

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
  ].filter(Boolean).join("     ");
}

function setFont(context: Ctx, weight: number, size: number, spacing = 0) {
  context.font = `${weight} ${Math.round(size)}px ${OVERLAY_FONT}`;
  context.letterSpacing = `${(spacing * size).toFixed(2)}px`;
}
/* The largest size (down to `min`) at which the text still fits `maxWidth`. */
function fit(context: Ctx, text: string, weight: number, maxWidth: number, start: number, min: number, spacing = 0) {
  let size = start;
  while (size > min) { setFont(context, weight, size, spacing); if (context.measureText(text).width <= maxWidth) break; size -= 2; }
  return size;
}
/* One line of text that fades in (rising a little) from `at` seconds. */
function line(context: Ctx, text: string, x: number, y: number, now: number, at: number, alpha: number, rise: number, align: CanvasTextAlign = "left") {
  const progress = rampIn(now, at, 0.7);
  if (progress <= 0 || alpha <= 0) return;
  context.save(); context.globalAlpha = alpha * progress; context.textAlign = align; context.fillText(text, x, y + rise * (1 - progress)); context.restore();
}

export type OverlayState = { logo?: CanvasImageSource & { width: number; height: number } | null };

/* Draws one frame's overlays on top of the already-drawn film frame. */
export function drawListingOverlays(context: CanvasRenderingContext2D, width: number, height: number, now: number, duration: number, branding: OverlayBranding, showOpening: boolean, showClosing: boolean, state: OverlayState = {}) {
  const ctx = context as Ctx;
  const u = width / (width >= height ? 1280 : 800); // one design unit
  const margin = 76 * u;
  ctx.textBaseline = "alphabetic";

  /* ---- opening: property details, bottom left ---- */
  if (showOpening) {
    const openStart = 0.45;
    const openEnd = Math.min(openStart + 4, Math.max(openStart + 2.2, duration * 0.5));
    const alpha = smooth((now - openStart) / 0.9) * smooth((openEnd - now) / 0.8);
    if (alpha > 0) {
      const shade = ctx.createLinearGradient(0, height * 0.5, 0, height);
      shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(1, `rgba(0,0,0,${0.58 * alpha})`);
      ctx.save(); ctx.fillStyle = shade; ctx.fillRect(0, height * 0.5, width, height * 0.5); ctx.restore();
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.28)"; ctx.shadowBlur = 18 * u;
      const maxWidth = width - margin * 2.2;
      const title = branding.listingTitle.trim(); const facts = listingFactsText(branding); const price = branding.listingPrice.trim(); const message = branding.listingMessage.trim();
      const rise = 16 * u; let y = height - margin;
      // Built from the bottom up so the block always sits on the same baseline.
      if (message) { ctx.fillStyle = "rgba(255,255,255,.72)"; setFont(ctx, 400, 21 * u, 0.02); line(ctx, message, margin, y, now, openStart + 0.75, alpha, rise); y -= 48 * u; }
      if (facts || price) {
        ctx.fillStyle = "rgba(255,255,255,.9)";
        const text = [facts, price].filter(Boolean).join("     ");
        setFont(ctx, 500, 24 * u, 0.06); line(ctx, text, margin, y, now, openStart + 0.5, alpha, rise); y -= 62 * u;
      }
      if (title) { ctx.fillStyle = "#ffffff"; const size = fit(ctx, title, 300, maxWidth, 66 * u, 28 * u, -0.01); setFont(ctx, 300, size, -0.01); line(ctx, title, margin, y, now, openStart + 0.25, alpha, rise); y -= size * 1.05; }
      // a short hairline above the block
      const ruleProgress = rampIn(now, openStart, 0.8);
      ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.globalAlpha = alpha * ruleProgress; ctx.fillRect(margin, y - 8 * u, 54 * u * ruleProgress, 2 * u);
      ctx.restore();
    }
  }

  /* ---- ending: the film dims to dark, the agent appears, all fades to black ---- */
  const closing = Math.min(duration * 0.45, showClosing ? 4.2 : 1);
  const closeStart = duration - closing;
  const endFade = rampIn(now, duration - 0.9, 0.9);
  const dim = showClosing ? rampIn(now, closeStart, 1.1) * 0.94 : 0;
  const dark = Math.max(dim, endFade);
  if (dark > 0) { ctx.save(); ctx.fillStyle = `rgba(7,7,8,${dark})`; ctx.fillRect(0, 0, width, height); ctx.restore(); }

  if (showClosing) {
    const name = branding.agentName.trim(); const phone = branding.agentPhone.trim(); const email = branding.agentEmail.trim(); const logo = state.logo;
    const alpha = 1 - endFade;
    const textStart = closeStart + 0.9;
    if (alpha > 0 && now > textStart) {
      const centerX = width / 2; const maxWidth = width - margin * 2;
      const rows: { kind: "logo" | "name" | "rule" | "phone" | "email"; size: number }[] = [];
      let logoHeight = 0;
      if (logo) { logoHeight = Math.min(height * 0.16, 120 * u); rows.push({ kind: "logo", size: logoHeight }); }
      if (name) rows.push({ kind: "name", size: 56 * u });
      if (name && (phone || email)) rows.push({ kind: "rule", size: 2 * u });
      if (phone) rows.push({ kind: "phone", size: 26 * u });
      if (email) rows.push({ kind: "email", size: 24 * u });
      const gap = (row: { kind: string }) => row.kind === "logo" ? 40 * u : row.kind === "name" ? 30 * u : row.kind === "rule" ? 34 * u : 16 * u;
      const total = rows.reduce((sum, row, index) => sum + (row.kind === "rule" ? row.size : row.size * (row.kind === "logo" ? 1 : 1.0)) + (index < rows.length - 1 ? gap(row) : 0), 0);
      let y = (height - total) / 2;
      ctx.save(); ctx.shadowColor = "transparent";
      rows.forEach((row, index) => {
        const at = textStart + index * 0.18; const progress = rampIn(now, at, 0.8); const rise = 12 * u * (1 - progress); const a = alpha * progress;
        if (row.kind === "logo" && logo) {
          const scale = Math.min(row.size / logo.height, (maxWidth * 0.5) / logo.width); const w = logo.width * scale; const h = logo.height * scale;
          ctx.save(); ctx.globalAlpha = a; ctx.drawImage(logo, centerX - w / 2, y + (row.size - h) / 2 + rise, w, h); ctx.restore();
        } else if (row.kind === "rule") {
          ctx.save(); ctx.globalAlpha = a * 0.6; ctx.fillStyle = "#ffffff"; ctx.fillRect(centerX - 28 * u * progress, y + rise, 56 * u * progress, row.size); ctx.restore();
        } else if (row.kind === "name") {
          ctx.fillStyle = "#ffffff"; const size = fit(ctx, name, 300, maxWidth, row.size, 28 * u, 0.01); setFont(ctx, 300, size, 0.01); line(ctx, name, centerX, y + row.size * 0.82, now, at, alpha, 12 * u, "center");
        } else {
          ctx.fillStyle = "rgba(255,255,255,.74)"; setFont(ctx, 400, row.size, 0.07); line(ctx, row.kind === "phone" ? phone : email, centerX, y + row.size * 0.82, now, at, alpha, 12 * u, "center");
        }
        y += row.size + gap(row);
      });
      ctx.restore();
    }
  }
}
