import { prisma } from "@/lib/prisma";

type CreateNoteInput = {
  contactId: string;
  body: string;
  organizationId?: string;
};

type GhlNoteResponse = {
  id?: string;
};

type CreateContactInput = {
  name: string;
  email?: string;
  phone?: string;
  organizationId?: string;
};

type GhlContactResponse = {
  id?: string;
  contact?: {
    id?: string;
  };
};

type CreateCustomObjectRecordInput = {
  objectKey: string;
  key?: string;
  properties: Record<string, unknown>;
  organizationId?: string;
};

type GhlCustomObjectRecordResponse = {
  id?: string;
  record?: {
    id?: string;
  };
};

type OrganizationGhlConfig = {
  ghlApiBaseUrl: string | null;
  ghlLocationId: string | null;
  ghlAccessToken: string | null;
  ghlContactSyncMaxPages: number | null;
  ghlVisitsObjectKey: string | null;
  ghlVisitsFieldClientNameKey: string | null;
  ghlVisitsFieldOwnerKey: string | null;
  ghlVisitsFieldVisitDateKey: string | null;
  ghlVisitsFieldNotesKey: string | null;
  ghlVisitsFieldTitleKey: string | null;
};

export type GhlConfig = {
  apiBase: string;
  locationId: string;
  accessToken: string;
  contactSyncMaxPages: number;
  visitsObjectKey?: string;
  visitsFieldClientNameKey?: string;
  visitsFieldOwnerKey?: string;
  visitsFieldVisitDateKey?: string;
  visitsFieldNotesKey?: string;
  visitsFieldTitleKey?: string;
};

const DEFAULT_API_BASE = process.env.GHL_API_BASE_URL;
const DEFAULT_LOCATION_ID = process.env.GHL_LOCATION_ID;
const DEFAULT_ACCESS_TOKEN = process.env.GHL_ACCESS_TOKEN;

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parsePositiveInt(value: string | number | null | undefined, fallback: number) {
  const raw = typeof value === "number" ? value : Number(value ?? "");
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.floor(raw);
}

async function getOrganizationConfig(organizationId?: string): Promise<OrganizationGhlConfig | null> {
  const normalizedOrganizationId = normalizeText(organizationId);
  if (!normalizedOrganizationId) {
    return null;
  }

  return prisma.organization.findUnique({
    where: { id: normalizedOrganizationId },
    select: {
      ghlApiBaseUrl: true,
      ghlLocationId: true,
      ghlAccessToken: true,
      ghlContactSyncMaxPages: true,
      ghlVisitsObjectKey: true,
      ghlVisitsFieldClientNameKey: true,
      ghlVisitsFieldOwnerKey: true,
      ghlVisitsFieldVisitDateKey: true,
      ghlVisitsFieldNotesKey: true,
      ghlVisitsFieldTitleKey: true
    }
  });
}

function headersForToken(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: "2021-07-28",
    "Content-Type": "application/json"
  };
}

export async function getGhlHeaders(organizationId?: string) {
  const config = await getGhlConfig(organizationId);
  return headersForToken(config.accessToken);
}

export async function getGhlConfig(organizationId?: string): Promise<GhlConfig> {
  const organizationConfig = await getOrganizationConfig(organizationId);

  const apiBase =
    normalizeText(organizationConfig?.ghlApiBaseUrl) ?? normalizeText(DEFAULT_API_BASE);
  const locationId =
    normalizeText(organizationConfig?.ghlLocationId) ?? normalizeText(DEFAULT_LOCATION_ID);
  const accessToken =
    normalizeText(organizationConfig?.ghlAccessToken) ?? normalizeText(DEFAULT_ACCESS_TOKEN);

  if (!apiBase || !locationId || !accessToken) {
    throw new Error(
      "Missing Vynor App config. Configure the organization integration fields or fallback env vars."
    );
  }

  const contactSyncMaxPages = parsePositiveInt(
    organizationConfig?.ghlContactSyncMaxPages ?? process.env.GHL_CONTACT_SYNC_MAX_PAGES,
    200
  );

  return {
    apiBase,
    locationId,
    accessToken,
    contactSyncMaxPages,
    visitsObjectKey:
      normalizeText(organizationConfig?.ghlVisitsObjectKey) ??
      normalizeText(process.env.GHL_VISITS_OBJECT_KEY),
    visitsFieldClientNameKey:
      normalizeText(organizationConfig?.ghlVisitsFieldClientNameKey) ??
      normalizeText(process.env.GHL_VISITS_FIELD_CLIENT_NAME_KEY),
    visitsFieldOwnerKey:
      normalizeText(organizationConfig?.ghlVisitsFieldOwnerKey) ??
      normalizeText(process.env.GHL_VISITS_FIELD_OWNER_KEY),
    visitsFieldVisitDateKey:
      normalizeText(organizationConfig?.ghlVisitsFieldVisitDateKey) ??
      normalizeText(process.env.GHL_VISITS_FIELD_VISIT_DATE_KEY),
    visitsFieldNotesKey:
      normalizeText(organizationConfig?.ghlVisitsFieldNotesKey) ??
      normalizeText(process.env.GHL_VISITS_FIELD_NOTES_KEY),
    visitsFieldTitleKey:
      normalizeText(organizationConfig?.ghlVisitsFieldTitleKey) ??
      normalizeText(process.env.GHL_VISITS_FIELD_TITLE_KEY)
  };
}

export async function createGhlContactNote(input: CreateNoteInput): Promise<GhlNoteResponse> {
  const config = await getGhlConfig(input.organizationId);
  const headers = headersForToken(config.accessToken);

  const response = await fetch(`${config.apiBase}/contacts/${input.contactId}/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      body: input.body
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vynor App note request failed: ${response.status} ${text}`);
  }

  return (await response.json()) as GhlNoteResponse;
}

function splitName(fullName: string) {
  const trimmed = fullName.trim();
  const [firstName, ...rest] = trimmed.split(/\s+/);
  const lastName = rest.join(" ").trim();
  return {
    firstName: firstName || "Sem",
    lastName: lastName || "Nome"
  };
}

export async function createGhlContact(input: CreateContactInput): Promise<{ id: string }> {
  const config = await getGhlConfig(input.organizationId);
  const headers = headersForToken(config.accessToken);
  const { firstName, lastName } = splitName(input.name);

  const response = await fetch(`${config.apiBase}/contacts/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      locationId: config.locationId,
      firstName,
      lastName,
      name: input.name,
      email: input.email,
      phone: input.phone
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vynor App create contact failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as GhlContactResponse;
  const id = json.id ?? json.contact?.id;
  if (!id) {
    throw new Error("Vynor App create contact returned no id");
  }

  return { id };
}

export async function createGhlCustomObjectRecord(
  input: CreateCustomObjectRecordInput
): Promise<{ id: string }> {
  const config = await getGhlConfig(input.organizationId);
  const headers = headersForToken(config.accessToken);

  const response = await fetch(`${config.apiBase}/objects/${input.objectKey}/records`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      locationId: config.locationId,
      key: input.key,
      properties: input.properties
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vynor App create object record failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as GhlCustomObjectRecordResponse;
  const id = json.id ?? json.record?.id;
  if (!id) {
    throw new Error("Vynor App create object record returned no id");
  }

  return { id };
}
