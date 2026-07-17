import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { classifyText } from "@/lib/classify";

export async function POST(req: NextRequest) {
  const token = await getToken({ req });
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const transcript = typeof body?.transcript === "string" ? body.transcript : "";

  if (!transcript.trim()) {
    return NextResponse.json({ entries: [] });
  }

  const entries = await classifyText(transcript);
  return NextResponse.json({ entries });
}
