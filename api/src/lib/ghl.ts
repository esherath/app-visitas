type CreateNoteInput = {
  contactId: string;
  body: string;
};

type GhlNoteResponse = {
  id?: string;
};

type CreateContactInput = {
  name: string;
  email?: string;
  phone?: string;
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
};

type GhlCustomObjectRecordResponse = {
  id?: string;
  record?: {
    id?: string;
  };
};

export const apiBase = process.env.GHL_API_BASE_URL;
export const locationId = process.env.GHL_LOCATION_ID;
export const accessToken = process.env.GHL_ACCESS_TOKEN;

function getHeaders() {
  if (!accessToken) {
    throw new Error("Missing GHL env var: GHL_ACCESS_TOKEN");
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    Version: "2021-07-28",
    "Content-Type": "application/json"
  };
}

export function getGhlHeaders() {
  return getHeaders();
}

export function getGhlConfig() {
  if (!apiBase || !locationId || !accessToken) {
    throw new Error("Missing GHL env vars: GHL_API_BASE_URL, GHL_LOCATION_ID or GHL_ACCESS_TOKEN");
  }

  return {
    apiBase,
    locationId,
    accessToken
  };
}

export async function createGhlContactNote(input: CreateNoteInput): Promise<GhlNoteResponse> {
  if (!apiBase) {
    throw new Error("Missing env var GHL_API_BASE_URL");
  }

  const response = await fetch(`${apiBase}/contacts/${input.contactId}/notes`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      body: input.body
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GHL note request failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as GhlNoteResponse;
  return json;
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
  const { apiBase, locationId } = getGhlConfig();
  const { firstName, lastName } = splitName(input.name);

  const response = await fetch(`${apiBase}/contacts/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      locationId,
      firstName,
      lastName,
      name: input.name,
      email: input.email,
      phone: input.phone
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GHL create contact failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as GhlContactResponse;
  const id = json.id ?? json.contact?.id;
  if (!id) {
    throw new Error("GHL create contact returned no id");
  }

  return { id };
}

export async function createGhlCustomObjectRecord(
  input: CreateCustomObjectRecordInput
): Promise<{ id: string }> {
  const { apiBase, locationId } = getGhlConfig();

  const response = await fetch(`${apiBase}/objects/${input.objectKey}/records`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      locationId,
      key: input.key,
      properties: input.properties
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GHL create object record failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as GhlCustomObjectRecordResponse;
  const id = json.id ?? json.record?.id;
  if (!id) {
    throw new Error("GHL create object record returned no id");
  }

  return { id };
}
