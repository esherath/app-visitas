import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGhlContact, createGhlCustomObjectRecord } from "@/lib/ghl";
import { SyncRequestSchema } from "@/lib/validation";
import { requireAuth, unauthorized } from "@/lib/auth";

type SyncResult = {
  localVisitId: string;
  success: boolean;
  error?: string;
};

const VISIT_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatVisitDateForGhl(dateInput: string) {
  const parsedDate = new Date(dateInput);
  if (Number.isNaN(parsedDate.getTime())) {
    return dateInput;
  }

  return VISIT_DATE_FORMATTER.format(parsedDate).replace(",", "");
}

function parseCustomObjectToken(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const tokenMatch = normalized.match(/^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/);
  if (!tokenMatch) {
    return null;
  }

  const tokenValue = tokenMatch[1];
  if (!tokenValue.startsWith("custom_objects.")) {
    return null;
  }

  const parts = tokenValue.split(".");
  if (parts.length < 2) {
    return null;
  }

  const objectKey = parts.length >= 2 ? parts.slice(0, 2).join(".") : tokenValue;
  const fieldKey = parts.length >= 3 ? parts[parts.length - 1] : tokenValue;

  return {
    objectKey,
    fieldKey
  };
}

function resolveFieldKey(value: string | null | undefined) {
  const parsed = parseCustomObjectToken(value);
  return parsed?.fieldKey ?? normalizeText(value);
}

function visitsObjectConfig() {
  const rawObjectKey = normalizeText(process.env.GHL_VISITS_OBJECT_KEY);
  const rawClientField = process.env.GHL_VISITS_FIELD_CLIENT_NAME_KEY;
  const rawOwnerField = process.env.GHL_VISITS_FIELD_OWNER_KEY;
  const rawVisitDateField = process.env.GHL_VISITS_FIELD_VISIT_DATE_KEY;
  const rawNotesField = process.env.GHL_VISITS_FIELD_NOTES_KEY;
  const rawTitleField = process.env.GHL_VISITS_FIELD_TITLE_KEY;

  const parsedObjectFromObjectKey = parseCustomObjectToken(rawObjectKey);
  const parsedObjectFromClient = parseCustomObjectToken(rawClientField);
  const parsedObjectFromOwner = parseCustomObjectToken(rawOwnerField);
  const parsedObjectFromVisitDate = parseCustomObjectToken(rawVisitDateField);
  const parsedObjectFromNotes = parseCustomObjectToken(rawNotesField);
  const parsedObjectFromTitle = parseCustomObjectToken(rawTitleField);

  const objectKey =
    parsedObjectFromObjectKey?.objectKey ??
    rawObjectKey ??
    parsedObjectFromClient?.objectKey ??
    parsedObjectFromOwner?.objectKey ??
    parsedObjectFromVisitDate?.objectKey ??
    parsedObjectFromNotes?.objectKey ??
    parsedObjectFromTitle?.objectKey;

  const clientField = resolveFieldKey(rawClientField);
  const ownerField = resolveFieldKey(rawOwnerField);
  const visitDateField = resolveFieldKey(rawVisitDateField);
  const notesField = resolveFieldKey(rawNotesField);
  const titleField = resolveFieldKey(rawTitleField);

  if (!objectKey || !clientField || !visitDateField || !notesField) {
    throw new Error(
      "Missing GHL visit object env vars: GHL_VISITS_OBJECT_KEY (or {{ custom_objects.<obj>.<field> }}), GHL_VISITS_FIELD_CLIENT_NAME_KEY, GHL_VISITS_FIELD_VISIT_DATE_KEY, GHL_VISITS_FIELD_NOTES_KEY"
    );
  }

  return {
    objectKey,
    clientField,
    ownerField,
    visitDateField,
    notesField,
    titleField
  };
}

async function resolveClientForVisit(
  sellerId: string,
  item: {
    clientId: string;
    clientName?: string;
    clientEmail?: string;
    clientPhone?: string;
  }
) {
  const existing = await prisma.client.findFirst({
    where: {
      sellerId,
      OR: [{ id: item.clientId }, { ghlContactId: item.clientId }]
    },
    select: {
      id: true,
      name: true,
      ghlContactId: true
    }
  });

  if (existing?.ghlContactId) {
    return existing;
  }

  if (existing && !existing.ghlContactId) {
    const createdContact = await createGhlContact({
      name: normalizeText(item.clientName) ?? existing.name,
      email: normalizeText(item.clientEmail),
      phone: normalizeText(item.clientPhone)
    });

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: {
        ghlContactId: createdContact.id,
        name: normalizeText(item.clientName) ?? existing.name
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
          sellerId,
          ghlContactId: createdContact.id
        }
      },
      update: {
        name: updated.name,
        email: normalizeText(item.clientEmail) ?? null,
        phone: normalizeText(item.clientPhone) ?? null,
        lastSyncedAt: new Date()
      },
      create: {
        sellerId,
        ghlContactId: createdContact.id,
        name: updated.name,
        email: normalizeText(item.clientEmail) ?? null,
        phone: normalizeText(item.clientPhone) ?? null
      }
    });

    return updated;
  }

  const localLikeId = item.clientId.startsWith("local-client-");
  if (localLikeId) {
    const createdContact = await createGhlContact({
      name: normalizeText(item.clientName) ?? "Contato sem nome",
      email: normalizeText(item.clientEmail),
      phone: normalizeText(item.clientPhone)
    });

    await prisma.ghlContact.upsert({
      where: {
        sellerId_ghlContactId: {
          sellerId,
          ghlContactId: createdContact.id
        }
      },
      update: {
        name: normalizeText(item.clientName) ?? "Contato sem nome",
        email: normalizeText(item.clientEmail) ?? null,
        phone: normalizeText(item.clientPhone) ?? null,
        lastSyncedAt: new Date()
      },
      create: {
        sellerId,
        ghlContactId: createdContact.id,
        name: normalizeText(item.clientName) ?? "Contato sem nome",
        email: normalizeText(item.clientEmail) ?? null,
        phone: normalizeText(item.clientPhone) ?? null
      }
    });

    return await prisma.client.create({
      data: {
        id: createdContact.id,
        sellerId,
        name: normalizeText(item.clientName) ?? "Contato sem nome",
        ghlContactId: createdContact.id,
        externalRef: `sync:${sellerId}:${item.clientId}`
      },
      select: {
        id: true,
        name: true,
        ghlContactId: true
      }
    });
  }

  const fallbackName = normalizeText(item.clientName) ?? item.clientId;
  await prisma.ghlContact.upsert({
    where: {
      sellerId_ghlContactId: {
        sellerId,
        ghlContactId: item.clientId
      }
    },
    update: {
      name: fallbackName,
      email: normalizeText(item.clientEmail) ?? null,
      phone: normalizeText(item.clientPhone) ?? null,
      lastSyncedAt: new Date()
    },
    create: {
      sellerId,
      ghlContactId: item.clientId,
      name: fallbackName,
      email: normalizeText(item.clientEmail) ?? null,
      phone: normalizeText(item.clientPhone) ?? null
    }
  });

  return await prisma.client.upsert({
    where: { id: item.clientId },
    update: {
      sellerId,
      name: fallbackName,
      ghlContactId: item.clientId
    },
    create: {
      id: item.clientId,
      sellerId,
      name: fallbackName,
      ghlContactId: item.clientId
    },
    select: {
      id: true,
      name: true,
      ghlContactId: true
    }
  });
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  try {
    const body = await request.json();
    const payload = SyncRequestSchema.parse(body);
    const objectConfig = visitsObjectConfig();
    const seller = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true, ghlUserId: true }
    });

    const results: SyncResult[] = [];

    for (const item of payload.visits) {
      try {
        const resolvedClient = await resolveClientForVisit(auth.userId, {
          clientId: item.clientId,
          clientName: item.clientName,
          clientEmail: item.clientEmail,
          clientPhone: item.clientPhone
        });

        const existing = await prisma.visit.findUnique({
          where: { localVisitId: item.localVisitId },
          include: { client: true }
        });

        if (existing && existing.sellerId !== auth.userId) {
          throw new Error("localVisitId already exists for another seller");
        }

        let visit = existing;
        if (visit && visit.clientId !== resolvedClient.id) {
          visit = await prisma.visit.update({
            where: { id: visit.id },
            data: {
              clientId: resolvedClient.id
            },
            include: { client: true }
          });
        }

        if (!visit) {
          visit = await prisma.visit.create({
            data: {
              localVisitId: item.localVisitId,
              sellerId: auth.userId,
              clientId: resolvedClient.id,
              notes: item.notes,
              checkInAt: new Date(item.checkInAt),
              latitude: item.latitude,
              longitude: item.longitude,
              accuracyMeters: item.accuracyMeters,
              status: "PENDING"
            },
            include: { client: true }
          });
        }

        if (!visit.client.ghlContactId) {
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

        const properties: Record<string, unknown> = {
          [objectConfig.clientField]: visit.client.name,
          [objectConfig.visitDateField]: formatVisitDateForGhl(item.checkInAt),
          [objectConfig.notesField]: item.notes
        };
        if (objectConfig.ownerField && (seller?.ghlUserId || seller?.name)) {
          properties[objectConfig.ownerField] = seller?.ghlUserId ?? seller?.name ?? auth.email;
        }
        if (objectConfig.titleField) {
          properties[objectConfig.titleField] = `Visita ${visit.client.name}`;
        }

        const ghlVisitRecord = await createGhlCustomObjectRecord({
          objectKey: objectConfig.objectKey,
          properties
        });

        await prisma.visit.update({
          where: { id: visit.id },
          data: {
            status: "SYNCED",
            syncedAt: new Date(),
            ghlNoteId: ghlVisitRecord.id ?? null,
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

