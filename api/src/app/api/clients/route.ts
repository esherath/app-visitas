import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CreateClientSchema, UpdateClientSchema } from "@/lib/validation";
import { createGhlContact } from "@/lib/ghl";
import { requireAuth, unauthorized } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  const clients = await prisma.client.findMany({
    where: {
      sellerId: auth.userId,
      name: query
        ? {
            contains: query,
            mode: "insensitive"
          }
        : undefined
    },
    orderBy: { name: "asc" },
    take: Number.isFinite(limit) && limit > 0 ? limit : 50,
    select: {
      id: true,
      name: true,
      ghlContactId: true
    }
  });

  const ghlContactIds = clients
    .map((client) => client.ghlContactId)
    .filter((value): value is string => Boolean(value));
  const ghlContacts = ghlContactIds.length
    ? await prisma.ghlContact.findMany({
        where: {
          sellerId: auth.userId,
          ghlContactId: {
            in: ghlContactIds
          }
        },
        select: {
          ghlContactId: true,
          email: true,
          phone: true
        }
      })
    : [];
  const ghlById = new Map(ghlContacts.map((item) => [item.ghlContactId, item]));

  return NextResponse.json({
    clients: clients.map((client) => {
      const ghl = client.ghlContactId ? ghlById.get(client.ghlContactId) : undefined;
      return {
        id: client.id,
        name: client.name,
        ghlContactId: client.ghlContactId,
        email: ghl?.email ?? null,
        phone: ghl?.phone ?? null
      };
    })
  });
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  try {
    const body = await request.json();
    const payload = CreateClientSchema.parse(body);
    const idempotencyRef = payload.localClientId
      ? `mobile:${auth.userId}:${payload.localClientId}`
      : payload.externalRef?.trim();

    if (idempotencyRef) {
      const existingByRef = await prisma.client.findUnique({
        where: { externalRef: idempotencyRef },
        select: {
          id: true,
          name: true,
          ghlContactId: true
        }
      });

      if (existingByRef) {
        return NextResponse.json({ ok: true, client: existingByRef, duplicated: true });
      }
    }

    let ghlContactId = payload.ghlContactId?.trim() || undefined;
    if (!ghlContactId) {
      const createdContact = await createGhlContact({
        name: payload.name.trim(),
        email: payload.email?.trim(),
        phone: payload.phone?.trim()
      });
      ghlContactId = createdContact.id;
    }

    const existingByGhlContactId = await prisma.client.findFirst({
      where: {
        sellerId: auth.userId,
        ghlContactId
      },
      select: {
        id: true,
        name: true,
        ghlContactId: true
      }
    });

    if (existingByGhlContactId) {
      return NextResponse.json({ ok: true, client: existingByGhlContactId, duplicated: true });
    }

    const client = await prisma.client.create({
      data: {
        id: ghlContactId,
        name: payload.name.trim(),
        sellerId: auth.userId,
        externalRef: idempotencyRef,
        ghlContactId
      },
      select: {
        id: true,
        name: true,
        ghlContactId: true
      }
    });

    await prisma.ghlContact.upsert({
      where: {
        sellerId_ghlContactId: {
          sellerId: auth.userId,
          ghlContactId
        }
      },
      update: {
        name: payload.name.trim(),
        email: payload.email?.trim() || null,
        phone: payload.phone?.trim() || null,
        lastSyncedAt: new Date()
      },
      create: {
        sellerId: auth.userId,
        ghlContactId,
        name: payload.name.trim(),
        email: payload.email?.trim() || null,
        phone: payload.phone?.trim() || null
      }
    });

    return NextResponse.json({
      ok: true,
      client: {
        ...client,
        email: payload.email?.trim() || null,
        phone: payload.phone?.trim() || null
      }
    });
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
