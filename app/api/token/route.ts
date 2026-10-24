import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../_lib/account";

async function authorize() {
  const { env } = await import("cloudflare:workers");
  await requireAdmin(env);
}

export async function GET() {
  try {
    await authorize();
    const cookieStore = await cookies();
    return NextResponse.json({ connected: Boolean(process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    await authorize();
    const { token } = await request.json();
    if (typeof token !== "string" || !/^r8_[A-Za-z0-9_-]{20,}$/.test(token.trim())) {
      return NextResponse.json({ error: "That does not look like a valid Replicate API token." }, { status: 400 });
    }
    const response = NextResponse.json({ connected: true });
    response.cookies.set("wan_replicate_token", token.trim(), {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) { return jsonError(error); }
}

export async function DELETE() {
  try {
    await authorize();
    const response = NextResponse.json({ connected: false });
    response.cookies.set("wan_replicate_token", "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  } catch (error) { return jsonError(error); }
}
