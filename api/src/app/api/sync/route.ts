import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGhlContactNote } from "@/lib/ghl";
import { SyncRequestSchema } from "@/lib/validation";
import { requireAuth, unauthorized } from "@/lib/auth";

type SyncResult = {
  localVisitId: string;
  success: boolean;
  error?: string;
};

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  try {
    const body = await request.json();
    const payload = SyncRequestSchema.parse(body);
    const seller = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true, ghlUserId: true }
    });

    const results: SyncResult[] = [];

    for (const item of payload.visits) {
      try {
        const cachedContact = await prisma.ghlContact.findUnique({
          where: {
            sellerId_ghlContactId: {
              sellerId: auth.userId,
              ghlContactId: item.clientId
            }
          },
          select: {
            name: true
          }
        });

        await prisma.client.upsert({
          where: { id: item.clientId },
          update: {
            sellerId: auth.userId,
            ghlContactId: item.clientId,
            name: cachedContact?.name ?? item.clientId
          },
          create: {
            id: item.clientId,
            name: cachedContact?.name ?? item.clientId,
            sellerId: auth.userId,
            ghlContactId: item.clientId
          }
        });

        const existing = await prisma.visit.findUnique({
          where: { localVisitId: item.localVisitId },
          include: { client: true }
        });

        if (existing && existing.sellerId !== auth.userId) {
          throw new Error("localVisitId already exists for another seller");
        }

        const visit =
          existing ??
          (await prisma.visit.create({
            data: {
              localVisitId: item.localVisitId,
              sellerId: auth.userId,
              clientId: item.clientId,
              notes: item.notes,
              checkInAt: new Date(item.checkInAt),
              latitude: item.latitude,
              longitude: item.longitude,
              accuracyMeters: item.accuracyMeters,
              status: "PENDING"
            },
            include: { client: true }
          }));

        const contactId = visit.client.ghlContactId ?? item.clientId;
        if (!contactId) {
          await prisma.visit.update({
            where: { id: visit.id },
            data: {
              status: "FAILED",
              lastSyncError: "Client has no ghlContactId"
            }
          });

          results.push({
            localVisitId: item.localVisitId,
            success: false,
            error: "Client has no ghlContactId"
          });
          continue;
        }

        const noteBody = [
          "Visita registrada no app:",
          `- Vendedor: ${seller?.name ?? auth.email} (${seller?.email ?? auth.email})`,
          `- Vendedor (GHL User ID): ${seller?.ghlUserId ?? "nao vinculado"}`,
          `- Cliente: ${visit.client.name}`,
          `- Data: ${new Date(item.checkInAt).toISOString()}`,
          `- Coordenadas: ${item.latitude}, ${item.longitude}`,
          `- Observacoes: ${item.notes}`
        ].join("\n");

        const ghl = await createGhlContactNote({
          contactId,
          body: noteBody
        });

        await prisma.visit.update({
          where: { id: visit.id },
          data: {
            status: "SYNCED",
            syncedAt: new Date(),
            ghlNoteId: ghl.id ?? null,
            lastSyncError: null
          }
        });

        results.push({
          localVisitId: item.localVisitId,
          success: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";

        await prisma.visit.updateMany({
          where: { localVisitId: item.localVisitId },
          data: { status: "FAILED", lastSyncError: message }
        });

        results.push({
          localVisitId: item.localVisitId,
          success: false,
          error: message
        });
      }
    }

    return NextResponse.json({ ok: true, results });
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
