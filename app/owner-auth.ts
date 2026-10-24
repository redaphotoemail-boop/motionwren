import { getChatGPTUser, requireChatGPTUser } from "./chatgpt-auth";
import { redirect } from "next/navigation";

const OWNER_EMAIL = "reda.photoemail@gmail.com";

export async function requireOwner(returnTo: string) {
  const user = await requireChatGPTUser(returnTo);
  if (user.email.toLowerCase() !== OWNER_EMAIL) {
    redirect("/?owner=restricted");
  }
  return user;
}

export async function isOwnerRequest() {
  const user = await getChatGPTUser();
  return Boolean(user && user.email.toLowerCase() === OWNER_EMAIL);
}
