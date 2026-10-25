import Link from "next/link";
import { redirect } from "next/navigation";
import { configuredAdmins, getGoogleSession } from "../api/_lib/account";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const { env } = await import("cloudflare:workers");
  const session = await getGoogleSession(env);
  if (session) {
    redirect(configuredAdmins(env).has(session.email.toLowerCase()) ? "/admin" : "/dashboard");
  }
  const appleReady = Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
  const params = searchParams ? await searchParams : undefined;
  const showError = params?.error === "apple";

  return (
    <main className="motionwren-site">
      <div className="mw-wrap" style={{ maxWidth: 480, margin: "0 auto", padding: "96px 20px", textAlign: "center" }}>
        <h1>Welcome back</h1>
        <p>Sign in to your MotionWren workspace.</p>
        {showError && <p role="alert">Apple sign-in didn&apos;t complete. Please try again.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 32 }}>
          <a className="mw-button" href="/api/auth/google">Continue with Google</a>
          {appleReady ? (
            <a className="mw-button" style={{ background: "#000", color: "#fff" }} href="/api/auth/apple">Continue with Apple</a>
          ) : (
            <span className="mw-button" aria-disabled="true" style={{ background: "#000", color: "#fff", opacity: 0.5 }}>Continue with Apple (being set up)</span>
          )}
        </div>
        <p style={{ marginTop: 32 }}><Link href="/">Back to MotionWren</Link></p>
      </div>
    </main>
  );
}
