import { redirect } from "next/navigation";
import { configuredAdmins, getGoogleSession } from "../api/_lib/account";
import SignInShell from "./signin-shell";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams?: Promise<{ mode?: string; google?: string }> }) {
  const { env } = await import("cloudflare:workers");
  const session = await getGoogleSession(env);
  if (session) {
    redirect(configuredAdmins(env).has(session.email.toLowerCase()) ? "/admin" : "/dashboard");
  }
  const params = (await searchParams) || {};
  return <SignInShell initialMode={params.mode === "signup" ? "signup" : "signin"} googleFailed={params.google === "failed"} />;
}
