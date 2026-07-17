import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { createCalendarEvent } from "@/lib/calendar";
import { DetectedEntriesSchema } from "@/lib/schema";

export async function POST(req: NextRequest) {
  const token = await getToken({ req });
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (token.error === "RefreshAccessTokenError" || !token.accessToken) {
    return NextResponse.json(
      { error: "Google session expired. Please sign in again." },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = DetectedEntriesSchema.safeParse(body?.entries);
  if (!parsed.success || parsed.data.length === 0) {
    return NextResponse.json(
      { error: "No valid entries to log." },
      { status: 400 }
    );
  }

  const now = new Date();
  const results = await Promise.all(
    parsed.data.map((entry) =>
      createCalendarEvent(token.accessToken as string, entry, now)
    )
  );

  return NextResponse.json({ results });
}
