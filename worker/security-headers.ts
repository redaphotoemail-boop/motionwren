/* Security headers for every Worker response. Applied in worker/index.ts,
   the one choke point all responses pass through (pages, API routes, and
   the image-optimization endpoint), so no page or route has to remember
   them. Existing headers (Content-Type, Cache-Control, ...) are kept;
   only the security headers below are set, overwriting any conflicting
   value a route set itself.

   The CSP stays permissive where the app needs it: inline scripts and
   styles exist (the studio plan page is a big inline script, the admin
   pages carry scoped <style> blocks), so script-src and style-src allow
   'unsafe-inline'. Google Fonts is the only external origin the browser
   loads (fonts.googleapis.com CSS, fonts.gstatic.com files); Google
   sign-in is a redirect flow, not an embedded script, so no Google
   script origin is needed. No camera, microphone, or geolocation is
   used anywhere (photos come from file upload only), so those are off.
   Framing is same-origin only: the plan flow embeds /studio in an
   iframe, so X-Frame-Options is SAMEORIGIN, not DENY.

   Stripe (Nov 26 2026): payment is taken on our own page with Stripe's
   Payment Element (app/components/pay-sheet.tsx). Stripe.js must load from
   js.stripe.com, its card fields are Stripe iframes, and it talks to
   Stripe's API, so those Stripe origins are allowed for scripts, frames and
   connections, as Stripe's own CSP guide lists. Nothing else external. */

export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    "connect-src 'self' blob: data: https://api.stripe.com https://*.stripe.com https://cloudflareinsights.com",
    "frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join("; "),
};

/* Return a copy of the response with the security headers set. The
   original response is untouched; status, status text, and body pass
   through unchanged. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
