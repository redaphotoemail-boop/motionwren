import { configuredAdmins, getGoogleSession, type AccountEnv } from "./api/_lib/account";

/* Owner access is the signed-in session only: the account whose email is in
   FRAME_MOTION_ADMIN_EMAILS (the same check requireAdmin uses). No API route
   accepts a caller-supplied identity header as authentication — the old
   ChatGPT identity-header path (app/chatgpt-auth.ts) is removed entirely. */
export async function isOwnerRequest(env: AccountEnv): Promise<boolean> {
  try {
    const identity = await getGoogleSession(env);
    return Boolean(identity && configuredAdmins(env).has(identity.email.toLowerCase()));
  } catch {
    return false;
  }
}
