import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VisitSyncItemSchema } from "@/lib/validation";
import { requireAuth, unauthorized } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(Number(limitRaw ?? "20"), 100);

  const visits = await prisma.visit.findMany({
    where: { sellerId: auth.userId },
    include: {
      client: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: { checkInAt: "desc" },
    take: Number.isFinite(limit) && limit > 0 ? limit : 20
  });

  return NextResponse.json({ visits });
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  try {
    const body = await request.json();
    const payload = VisitSyncItemSchema.parse(body);

    const existing = await prisma.visit.findUnique({
      where: { localVisitId: payload.localVisitId },
      select: { id: true, sellerId: true }
    });

    if (existing) {
      if (existing.sellerId !== auth.userId) {
        return NextResponse.json({ ok: false, message: "localVisitId already exists" }, { status: 409 });
      }
      return NextResponse.json({ ok: true, duplicated: true });
    }

    await prisma.client.upsert({
      where: { id: payload.clientId },
      update: {
        sellerId: auth.userId,
        ghlContactId: payload.clientId
      },
      create: {
        id: payload.clientId,
        name: payload.clientId,
        sellerId: auth.userId,
        ghlContactId: payload.clientId
      }
    });

    const visit = await prisma.visit.create({
      data: {
        localVisitId: payload.localVisitId,
        sellerId: auth.userId,
        clientId: payload.clientId,
        notes: payload.notes,
        checkInAt: new Date(payload.checkInAt),
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracyMeters: payload.accuracyMeters,
        status: "PENDING"
      }
    });

    return NextResponse.json({ ok: true, visitId: visit.id });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Unexpected error"
      },
      { status: 400 }
    );
  }
}
