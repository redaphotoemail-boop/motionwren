import Link from "next/link";
import { redirect } from "next/navigation";
import { configuredAdmins, getGoogleSession } from "../api/_lib/account";
import EmailAuthForm from "./email-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const { env } = await import("cloudflare:workers");
  const session = await getGoogleSession(env);
  if (session) {
    redirect(configuredAdmins(env).has(session.email.toLowerCase()) ? "/admin" : "/dashboard");
  }

  return (
    <main className="motionwren-site">
      <div className="mw-wrap" style={{ maxWidth: 480, margin: "0 auto", padding: "96px 20px", textAlign: "center" }}>
        <h1>Welcome back</h1>
        <p>Sign in to your MotionWren workspace.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 32 }}>
          <a className="mw-button" href="/api/auth/google">Continue with Google</a>
          <EmailAuthForm />
        </div>
        <p style={{ marginTop: 32 }}><Link href="/">Back to MotionWren</Link></p>
      </div>
    </main>
  );
}
