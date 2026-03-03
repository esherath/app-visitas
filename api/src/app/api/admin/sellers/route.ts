import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasRole, requireAuth, unauthorized } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!hasRole(auth, "MASTER")) {
    return unauthorized("Only master can access this resource");
  }

  const sellers = await prisma.user.findMany({
    where: {
      role: "SELLER"
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      ghlUserId: true
    }
  });

  return NextResponse.json({ sellers });
}

export async function PATCH(request: Request) {
  const auth = requireAuth(request);
  if (!hasRole(auth, "MASTER")) {
    return unauthorized("Only master can access this resource");
  }

  try {
    const body = (await request.json()) as { sellerId?: string; ghlUserId?: string | null };
    const sellerId = body.sellerId?.trim();

    if (!sellerId) {
      return NextResponse.json({ ok: false, message: "sellerId is required" }, { status: 400 });
    }

    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { id: true, role: true }
    });

    if (!seller || seller.role !== "SELLER") {
      return NextResponse.json({ ok: false, message: "Seller not found" }, { status: 404 });
    }

    await prisma.user.update({
      where: { id: sellerId },
      data: {
        ghlUserId: body.ghlUserId?.trim() || null
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}
