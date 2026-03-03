import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, unauthorized } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, name: true, email: true, role: true, ghlUserId: true }
  });

  if (!user) {
    return unauthorized();
  }

  return NextResponse.json({ ok: true, user });
}

export async function PATCH(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as { ghlUserId?: string | null };
    const user = await prisma.user.update({
      where: { id: auth.userId },
      data: { ghlUserId: body.ghlUserId?.trim() || null },
      select: { id: true, name: true, email: true, role: true, ghlUserId: true }
    });

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}
