import type { ClientItem, PendingVisit } from "../types";

type SyncPayload = {
  visits: Array<{
    localVisitId: string;
    sellerId?: string;
    clientId: string;
    clientName?: string;
    clientEmail?: string;
    clientPhone?: string;
    notes: string;
    checkInAt: string;
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
  }>;
};

type RequestContext = {
  apiBaseUrl: string;
  token: string;
};

export type SyncApiResult = {
  localVisitId: string;
  success: boolean;
  error?: string;
};

function withBase(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

export async function syncVisitsToApi(ctx: RequestContext, payload: SyncPayload) {
  const response = await fetch(withBase(ctx.apiBaseUrl, "/api/sync"), {
    method: "POST",
    headers: authHeaders(ctx.token),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Sync API error ${response.status}`);
  }

  return (await response.json()) as { results: SyncApiResult[] };
}

export async function fetchClients(ctx: RequestContext, query?: string): Promise<ClientItem[]> {
  const params = new URLSearchParams({ limit: "50" });
  if (query && query.trim().length > 0) {
    params.set("q", query.trim());
  }

  const response = await fetch(withBase(ctx.apiBaseUrl, `/api/clients?${params.toString()}`), {
    headers: authHeaders(ctx.token)
  });
  if (!response.ok) {
    throw new Error(`Clients API error ${response.status}`);
  }
  const json = (await response.json()) as { clients: ClientItem[] };
  return json.clients;
}

export async function createClient(
  ctx: RequestContext,
  payload: { name: string; email?: string; phone?: string; localClientId?: string }
): Promise<ClientItem> {
  const response = await fetch(withBase(ctx.apiBaseUrl, "/api/clients"), {
    method: "POST",
    headers: authHeaders(ctx.token),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Create client failed: ${response.status}`);
  }
  const json = (await response.json()) as { client: ClientItem };
  return json.client;
}

export async function syncGhlContacts(
  ctx: RequestContext,
  options?: { fullSync?: boolean }
): Promise<{ contactsSynced: number; opportunitiesSynced: number; warnings?: string[] }> {
  const response = await fetch(withBase(ctx.apiBaseUrl, "/api/ghl/sync"), {
    method: "POST",
    headers: authHeaders(ctx.token),
    body: JSON.stringify({
      fullSync: Boolean(options?.fullSync)
    })
  });

  if (!response.ok) {
    throw new Error(`GHL sync failed: ${response.status}`);
  }

  return (await response.json()) as {
    contactsSynced: number;
    opportunitiesSynced: number;
    warnings?: string[];
  };
}

export async function fetchVisits(
  ctx: RequestContext,
  limit = 30
): Promise<
  Array<
    PendingVisit & {
      client?: { id: string; name: string };
    }
  >
> {
  const response = await fetch(withBase(ctx.apiBaseUrl, `/api/visits?limit=${limit}`), {
    headers: authHeaders(ctx.token)
  });
  if (!response.ok) {
    throw new Error(`Visits API error ${response.status}`);
  }
  const json = (await response.json()) as {
    visits: Array<{
      id: string;
      localVisitId: string;
      sellerId: string;
      clientId: string;
      notes: string;
      checkInAt: string;
      latitude: number;
      longitude: number;
      accuracyMeters?: number | null;
      status: "PENDING" | "SYNCED" | "FAILED";
      lastSyncError?: string | null;
      client?: { id: string; name: string };
    }>;
  };

  return json.visits.map((item, index) => ({
    id: index + 1,
    localVisitId: item.localVisitId,
    sellerId: item.sellerId,
    clientId: item.clientId,
    clientName: item.client?.name ?? null,
    notes: item.notes,
    checkInAt: item.checkInAt,
    latitude: item.latitude,
    longitude: item.longitude,
    accuracyMeters: item.accuracyMeters ?? null,
    syncStatus: item.status,
    lastError: item.lastSyncError ?? null,
    client: item.client
  }));
}

export type SellerItem = {
  id: string;
  name: string;
  email: string;
  ghlUserId?: string | null;
};

export type AdminVisitItem = PendingVisit & {
  seller?: { id: string; name: string; email: string };
  client?: { id: string; name: string };
};

export async function fetchAdminSellers(ctx: RequestContext): Promise<SellerItem[]> {
  const response = await fetch(withBase(ctx.apiBaseUrl, "/api/admin/sellers"), {
    headers: authHeaders(ctx.token)
  });
  if (!response.ok) {
    throw new Error(`Admin sellers API error ${response.status}`);
  }
  const json = (await response.json()) as { sellers: SellerItem[] };
  return json.sellers;
}

export async function fetchAdminVisits(
  ctx: RequestContext,
  params?: { sellerId?: string; from?: string; to?: string; limit?: number }
): Promise<AdminVisitItem[]> {
  const query = new URLSearchParams();
  if (params?.sellerId) {
    query.set("sellerId", params.sellerId);
  }
  if (params?.from) {
    query.set("from", params.from);
  }
  if (params?.to) {
    query.set("to", params.to);
  }
  query.set("limit", String(params?.limit ?? 500));

  const response = await fetch(withBase(ctx.apiBaseUrl, `/api/admin/visits?${query.toString()}`), {
    headers: authHeaders(ctx.token)
  });
  if (!response.ok) {
    throw new Error(`Admin visits API error ${response.status}`);
  }

  const json = (await response.json()) as {
    visits: Array<{
      localVisitId: string;
      sellerId: string;
      clientId: string;
      notes: string;
      checkInAt: string;
      latitude: number;
      longitude: number;
      accuracyMeters?: number | null;
      status: "PENDING" | "SYNCED" | "FAILED";
      lastSyncError?: string | null;
      client?: { id: string; name: string };
      seller?: { id: string; name: string; email: string };
    }>;
  };

  return json.visits.map((item, index) => ({
    id: index + 1,
    localVisitId: item.localVisitId,
    sellerId: item.sellerId,
    clientId: item.clientId,
    clientName: item.client?.name ?? null,
    notes: item.notes,
    checkInAt: item.checkInAt,
    latitude: item.latitude,
    longitude: item.longitude,
    accuracyMeters: item.accuracyMeters ?? null,
    syncStatus: item.status,
    lastError: item.lastSyncError ?? null,
    client: item.client,
    seller: item.seller
  }));
}
