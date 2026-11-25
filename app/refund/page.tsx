import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "../components/brand";
import { BASE_CENTS, BASE_SECONDS, EXTRA_PHOTO_CENTS, FIVE_PACK_CENTS, LONG_CENTS, LONG_SECONDS, MEMBER_FILMS, MEMBER_FILM_SECONDS, MEMBER_MONTHLY_CENTS, dollars, minPhotosFor } from "../pricing";

export const metadata: Metadata = { title: "Refund Policy", description: "When MotionWren refunds an order and how to ask for one.", alternates: { canonical: "/refund" } };

export default function RefundPage() {
  return (
    <main className="policy-page" id="main-content">
      <nav className="policy-nav">
        <Link href="/" aria-label="MotionWren home"><Wordmark size={26} /></Link>
        <Link className="text-btn" href="/">Back to home</Link>
      </nav>
      <article className="policy-body">
        <span className="eyebrow">REFUNDS</span>
        <h1>Refund Policy</h1>
        <p className="policy-date">Last updated November 25, 2026</p>
        <section>
          <h2>Plans and prices</h2>
          <p>{`Films are priced by length: up to ${BASE_SECONDS} seconds ${dollars(BASE_CENTS)}, up to ${LONG_SECONDS} seconds ${dollars(LONG_CENTS)}. With automatic length, each photo becomes a 5-second scene: ${dollars(LONG_CENTS)} for up to ${LONG_SECONDS / 5} photos, then ${dollars(EXTRA_PHOTO_CENTS)} for each extra photo. A film needs enough photos for its length: ${minPhotosFor(BASE_SECONDS)} for ${BASE_SECONDS} seconds, ${minPhotosFor(LONG_SECONDS)} for ${LONG_SECONDS} seconds. Five-pack: ${dollars(FIVE_PACK_CENTS)} for five video credits, each covering one ${BASE_SECONDS}-second film; a longer film pays only the difference. Membership: ${dollars(MEMBER_MONTHLY_CENTS)} per month for ${MEMBER_FILMS} films each month, each up to ${MEMBER_FILM_SECONDS} seconds. The price shown at checkout is the total you pay; any applicable tax is shown before you pay.`}</p>
        </section>
        <section>
          <h2>If we can&apos;t finish your film</h2>
          <p>You are never charged twice for the same film. If something goes wrong while your film is being made, we fix it and keep going. If it still is not ready, your dashboard lets you ask for your credit back in one tap, and anything you paid above the credit for a longer film is refunded to your card. If you have any trouble, contact us and we will put it right.</p>
        </section>
        <section>
          <h2>Refunds for videos that were made</h2>
          <p>Video production is a digital service made to order from your photos. Once a video has been successfully generated, it cannot be returned, so the credit used for it is not refundable. If a finished video is unusable because of a fault in our service, tell us within 14 days of the order and we will remake it or return the credit. A film that changes the property shown in your photos, by adding, removing or moving rooms, furniture, views or vehicles, counts as a fault.</p>
        </section>
        <section>
          <h2>Refunds for unused credits</h2>
          <p>If you have not used any video from a purchase, you may ask for a refund within 14 days of the purchase and we will refund the full amount to your original payment method. After 14 days, or after any video from the purchase has been generated, unused credits are not refundable.</p>
        </section>
        <section>
          <h2>Credit expiry</h2>
          <p>{`Credits do not expire while your account is active. Membership adds ${MEMBER_FILMS} films at the start of each billing month.`}</p>
        </section>
        <section>
          <h2>Cancelling your membership</h2>
          <p>You can cancel your membership at any time from your dashboard (Manage or cancel membership). Your membership and its films continue until the end of the billing period you have already paid for, and the subscription does not renew after that. Cancelling does not refund the current billing period.</p>
        </section>
        <section>
          <h2>How to ask for a refund</h2>
          <p>Email <a href="mailto:info@redaphoto.com">info@redaphoto.com</a> with the email address on your account, the order or payment date, and what happened. We aim to answer within 3 business days. Approved refunds are returned to the original payment method within 10 business days.</p>
        </section>
        <p className="policy-note">If a term on this page conflicts with a term shown at checkout, the checkout term applies to that order.</p>
        <p className="policy-note">Contact: MotionWren, Boston, Massachusetts — <a href="mailto:info@redaphoto.com">info@redaphoto.com</a>. See also our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
      </article>
    </main>
  );
}
