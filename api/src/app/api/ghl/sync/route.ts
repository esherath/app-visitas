import { NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/lib/auth";
import { syncGhlDataForSeller } from "@/lib/ghl-sync";

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { fullSync?: boolean };
    const result = await syncGhlDataForSeller(auth.userId, auth.organizationId, {
      fullSync: Boolean(body.fullSync)
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}
