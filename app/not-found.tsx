import Link from "next/link";
import { Wordmark } from "./components/brand";

export const metadata = { title: "Page not found" };

/* Branded 404: one line of explanation and a way back. */
export default function NotFound() {
  return <main className="lost">
    <Link href="/" className="lost-home" aria-label="MotionWren home"><Wordmark size={28} /></Link>
    <div className="lost-body">
      <p className="eyebrow">404</p>
      <h1>This page isn&rsquo;t here.</h1>
      <p>The link may be old or mistyped.</p>
      <div className="lost-actions">
        <Link className="btn btn-ink btn-lg" href="/">Back to home</Link>
        <Link className="btn btn-ghost btn-lg" href="/dashboard">Your orders</Link>
      </div>
    </div>
  </main>;
}
