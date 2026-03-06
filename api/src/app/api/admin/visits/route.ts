import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasAnyRole, requireAuth, unauthorized } from "@/lib/auth";

function parseDateParam(value: string | null, end = false) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (end) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }
  if (!hasAnyRole(auth, ["MASTER", "SUPER_ADMIN"])) {
    return unauthorized("Only master can access this resource");
  }

  const { searchParams } = new URL(request.url);
  const sellerId = searchParams.get("sellerId")?.trim();
  const from = parseDateParam(searchParams.get("from"));
  const to = parseDateParam(searchParams.get("to"), true);
  const limitRaw = Number(searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200;

  const visits = await prisma.visit.findMany({
    where: {
      seller: {
        organizationId: auth.organizationId
      },
      sellerId: sellerId || undefined,
      checkInAt:
        from || to
          ? {
              gte: from ?? undefined,
              lte: to ?? undefined
            }
          : undefined
    },
    include: {
      client: {
        select: {
          id: true,
          name: true
        }
      },
      seller: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: { checkInAt: "desc" },
    take: limit
  });

  return NextResponse.json({ visits });
}
