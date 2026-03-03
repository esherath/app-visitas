import { prisma } from "@/lib/prisma";
import { getGhlConfig, getGhlHeaders } from "@/lib/ghl";
import type { Prisma } from "@prisma/client";

type RawContact = {
  id?: string;
  _id?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  ownerId?: string;
  assignedTo?: string;
  dateUpdated?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

type SyncSummary = {
  contactsSynced: number;
  opportunitiesSynced: number;
  cursor: string;
  warnings: string[];
};

function parseDate(input: unknown): Date | null {
  if (!input || typeof input !== "string") {
    return null;
  }
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return value;
}

function contactName(contact: RawContact) {
  if (contact.name && typeof contact.name === "string") {
    return contact.name.trim();
  }
  const first = typeof contact.firstName === "string" ? contact.firstName.trim() : "";
  const last = typeof contact.lastName === "string" ? contact.lastName.trim() : "";
  const joined = `${first} ${last}`.trim();
  return joined || "Sem nome";
}

function unwrapArray<T>(json: Record<string, unknown>, keys: string[]): T[] {
  for (const key of keys) {
    const value = json[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }
  return [];
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function ghlGet(path: string) {
  const { apiBase } = getGhlConfig();
  const response = await fetch(`${apiBase}${path}`, {
    method: "GET",
    headers: getGhlHeaders()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GHL GET ${path} failed: ${response.status} ${text}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

async function fetchAllContacts(lastUpdatedAfter?: string) {
  const { locationId } = getGhlConfig();
  const limit = 100;
  const maxPages = Number(process.env.GHL_CONTACT_SYNC_MAX_PAGES ?? "200");
  const out: RawContact[] = [];
  let page = 1;
  let startAfter: number | null = null;
  let startAfterId: string | null = null;

  for (let requestIndex = 1; requestIndex <= maxPages; requestIndex += 1) {
    const query = new URLSearchParams({
      locationId,
      limit: String(limit)
    });
    if (startAfter && startAfterId) {
      query.set("startAfter", String(startAfter));
      query.set("startAfterId", startAfterId);
    } else {
      query.set("page", String(page));
    }

    const json = await ghlGet(`/contacts/?${query.toString()}`);
    const contacts = unwrapArray<RawContact>(json, ["contacts", "data", "results"]);
    out.push(...contacts);
    if (contacts.length < limit) {
      break;
    }

    const last = contacts[contacts.length - 1];
    const lastId = (last?.id || last?._id || "").toString().trim();
    const lastUpdated = parseDate(last?.updatedAt ?? last?.dateUpdated);

    if (startAfter && startAfterId) {
      if (!lastId || !lastUpdated) {
        break;
      }
      startAfterId = lastId;
      startAfter = lastUpdated.getTime();
      continue;
    }

    if (page < 100) {
      page += 1;
      continue;
    }

    if (!lastId || !lastUpdated) {
      break;
    }

    startAfterId = lastId;
    startAfter = lastUpdated.getTime();
  }

  return out;
}

export async function syncGhlDataForSeller(
  sellerId: string,
  options?: { fullSync?: boolean }
): Promise<SyncSummary> {
  const warnings: string[] = [];
  const fullSync = options?.fullSync ?? false;
  const cursorKey = `ghl:last-sync:${sellerId}`;

  let lastCursor: string | undefined;
  if (!fullSync) {
    const cursor = await prisma.syncCursor.findUnique({ where: { key: cursorKey } });
    lastCursor = cursor?.value;
    if (lastCursor) {
      warnings.push("Incremental cursor ignored for contacts endpoint; running full sync upsert.");
    }
  }

  const contacts = await fetchAllContacts(lastCursor);
  for (const raw of contacts) {
    const ghlContactId = (raw.id || raw._id || "").toString().trim();
    if (!ghlContactId) {
      continue;
    }

    const name = contactName(raw);
    const email = typeof raw.email === "string" ? raw.email : null;
    const phone = typeof raw.phone === "string" ? raw.phone : null;
    const ownerUserId =
      typeof raw.ownerId === "string"
        ? raw.ownerId
        : typeof raw.assignedTo === "string"
          ? raw.assignedTo
          : null;
    const sourceUpdatedAt = parseDate(raw.updatedAt ?? raw.dateUpdated);

    await prisma.ghlContact.upsert({
      where: {
        sellerId_ghlContactId: { sellerId, ghlContactId }
      },
      update: {
        name,
        email,
        phone,
        ownerUserId,
        sourceUpdatedAt,
        rawJson: toJsonValue(raw),
        lastSyncedAt: new Date()
      },
      create: {
        sellerId,
        ghlContactId,
        name,
        email,
        phone,
        ownerUserId,
        sourceUpdatedAt,
        rawJson: toJsonValue(raw)
      }
    });

    await prisma.client.upsert({
      where: { id: ghlContactId },
      update: {
        name,
        sellerId,
        ghlContactId
      },
      create: {
        id: ghlContactId,
        name,
        sellerId,
        ghlContactId
      }
    });
  }

  const cursor = new Date().toISOString();
  await prisma.syncCursor.upsert({
    where: { key: cursorKey },
    update: { value: cursor },
    create: { key: cursorKey, value: cursor }
  });

  return {
    contactsSynced: contacts.length,
    opportunitiesSynced: 0,
    cursor,
    warnings
  };
}
