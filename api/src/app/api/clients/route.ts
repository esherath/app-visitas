import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CreateClientSchema, UpdateClientSchema } from "@/lib/validation";
import { requireAuth, unauthorized } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  const clients = await prisma.client.findMany({
    where: { sellerId: auth.userId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      ghlContactId: true
    }
  });

  return NextResponse.json({ clients });
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  try {
    const body = await request.json();
    const payload = CreateClientSchema.parse(body);

    const client = await prisma.client.create({
      data: {
        name: payload.name,
        sellerId: auth.userId,
        externalRef: payload.externalRef,
        ghlContactId: payload.ghlContactId
      },
      select: {
        id: true,
        name: true,
        ghlContactId: true
      }
    });

    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  try {
    const body = await request.json();
    const payload = UpdateClientSchema.parse(body);

    const current = await prisma.client.findFirst({
      where: { id: payload.clientId, sellerId: auth.userId },
      select: { id: true }
    });

    if (!current) {
      return NextResponse.json({ ok: false, message: "Client not found" }, { status: 404 });
    }

    const client = await prisma.client.update({
      where: { id: payload.clientId },
      data: { ghlContactId: payload.ghlContactId },
      select: { id: true, name: true, ghlContactId: true }
    });

    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}
