import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  revokeSessionByToken,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (token) {
      await revokeSessionByToken(token);
    }
  } catch {
    // Always clear cookie even if DB revoke failed
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
