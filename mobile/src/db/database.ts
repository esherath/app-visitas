import * as SQLite from "expo-sqlite";
import type { ClientItem, NewVisitInput, PendingVisit } from "../types";

const dbPromise = SQLite.openDatabaseAsync("trinit_visitas.db");

export type PendingClient = {
  localClientId: string;
  sellerId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  syncStatus: "PENDING" | "SYNCED" | "FAILED";
  lastError?: string | null;
  remoteClientId?: string | null;
};

export async function initDb() {
  const db = await dbPromise;

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS visits_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_visit_id TEXT NOT NULL UNIQUE,
      seller_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_name TEXT,
      client_email TEXT,
      client_phone TEXT,
      notes TEXT NOT NULL,
      check_in_at TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_meters REAL,
      sync_status TEXT NOT NULL DEFAULT 'PENDING',
      last_error TEXT
    );
  `);

  await db.execAsync(`
    ALTER TABLE visits_queue ADD COLUMN client_name TEXT;
  `).catch(() => undefined);
  await db.execAsync(`
    ALTER TABLE visits_queue ADD COLUMN client_email TEXT;
  `).catch(() => undefined);
  await db.execAsync(`
    ALTER TABLE visits_queue ADD COLUMN client_phone TEXT;
  `).catch(() => undefined);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS clients_cache (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ghl_contact_id TEXT
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS clients_queue (
      local_client_id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      sync_status TEXT NOT NULL DEFAULT 'PENDING',
      last_error TEXT,
      remote_client_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export async function addVisitToQueue(visit: NewVisitInput) {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT INTO visits_queue (
      local_visit_id, seller_id, client_id, client_name, client_email, client_phone,
      notes, check_in_at, latitude, longitude, accuracy_meters, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
    [
      visit.localVisitId,
      visit.sellerId,
      visit.clientId,
      visit.clientName ?? null,
      visit.clientEmail ?? null,
      visit.clientPhone ?? null,
      visit.notes,
      visit.checkInAt,
      visit.latitude,
      visit.longitude,
      visit.accuracyMeters ?? null
    ]
  );
}

export async function getPendingVisits(limit = 50): Promise<PendingVisit[]> {
  const db = await dbPromise;
  const rows = await db.getAllAsync<{
    id: number;
    local_visit_id: string;
    seller_id: string;
    client_id: string;
    client_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    notes: string;
    check_in_at: string;
    latitude: number;
    longitude: number;
    accuracy_meters: number | null;
    sync_status: "PENDING" | "SYNCED" | "FAILED";
    last_error: string | null;
  }>(
    `SELECT * FROM visits_queue
     WHERE sync_status IN ('PENDING', 'FAILED')
     ORDER BY id ASC
     LIMIT ?`,
    [limit]
  );

  return rows.map((row) => ({
    id: row.id,
    localVisitId: row.local_visit_id,
    sellerId: row.seller_id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    notes: row.notes,
    checkInAt: row.check_in_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_meters,
    syncStatus: row.sync_status,
    lastError: row.last_error
  }));
}

export async function markVisitAsSynced(localVisitId: string) {
  const db = await dbPromise;
  await db.runAsync(
    `UPDATE visits_queue
     SET sync_status = 'SYNCED', last_error = NULL
     WHERE local_visit_id = ?`,
    [localVisitId]
  );
}

export async function markVisitAsFailed(localVisitId: string, error: string) {
  const db = await dbPromise;
  await db.runAsync(
    `UPDATE visits_queue
     SET sync_status = 'FAILED', last_error = ?
     WHERE local_visit_id = ?`,
    [error, localVisitId]
  );
}

export async function markVisitAsPending(localVisitId: string) {
  const db = await dbPromise;
  await db.runAsync(
    `UPDATE visits_queue
     SET sync_status = 'PENDING'
     WHERE local_visit_id = ?`,
    [localVisitId]
  );
}

export async function countUnsyncedVisits() {
  const db = await dbPromise;
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM visits_queue
     WHERE sync_status IN ('PENDING', 'FAILED')`
  );

  return row?.total ?? 0;
}

export async function listRecentLocalVisits(limit = 20): Promise<PendingVisit[]> {
  const db = await dbPromise;
  const rows = await db.getAllAsync<{
    id: number;
    local_visit_id: string;
    seller_id: string;
    client_id: string;
    client_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    notes: string;
    check_in_at: string;
    latitude: number;
    longitude: number;
    accuracy_meters: number | null;
    sync_status: "PENDING" | "SYNCED" | "FAILED";
    last_error: string | null;
  }>(
    `SELECT * FROM visits_queue
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map((row) => ({
    id: row.id,
    localVisitId: row.local_visit_id,
    sellerId: row.seller_id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    notes: row.notes,
    checkInAt: row.check_in_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_meters,
    syncStatus: row.sync_status,
    lastError: row.last_error
  }));
}

export async function getVisitByLocalVisitId(localVisitId: string): Promise<PendingVisit | null> {
  const db = await dbPromise;
  const row = await db.getFirstAsync<{
    id: number;
    local_visit_id: string;
    seller_id: string;
    client_id: string;
    client_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    notes: string;
    check_in_at: string;
    latitude: number;
    longitude: number;
    accuracy_meters: number | null;
    sync_status: "PENDING" | "SYNCED" | "FAILED";
    last_error: string | null;
  }>(
    `SELECT * FROM visits_queue
     WHERE local_visit_id = ?
     LIMIT 1`,
    [localVisitId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    localVisitId: row.local_visit_id,
    sellerId: row.seller_id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    notes: row.notes,
    checkInAt: row.check_in_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_meters,
    syncStatus: row.sync_status,
    lastError: row.last_error
  };
}

export async function addClientToQueue(input: {
  localClientId: string;
  sellerId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}) {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT INTO clients_queue (
      local_client_id, seller_id, name, email, phone, sync_status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
    [
      input.localClientId,
      input.sellerId,
      input.name,
      input.email ?? null,
      input.phone ?? null,
      new Date().toISOString()
    ]
  );
}

export async function getPendingClients(limit = 50): Promise<PendingClient[]> {
  const db = await dbPromise;
  const rows = await db.getAllAsync<{
    local_client_id: string;
    seller_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    sync_status: "PENDING" | "SYNCED" | "FAILED";
    last_error: string | null;
    remote_client_id: string | null;
  }>(
    `SELECT local_client_id, seller_id, name, email, phone, sync_status, last_error, remote_client_id
     FROM clients_queue
     WHERE sync_status IN ('PENDING', 'FAILED')
     ORDER BY created_at ASC
     LIMIT ?`,
    [limit]
  );

  return rows.map((row) => ({
    localClientId: row.local_client_id,
    sellerId: row.seller_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    syncStatus: row.sync_status,
    lastError: row.last_error,
    remoteClientId: row.remote_client_id
  }));
}

export async function markClientAsSynced(localClientId: string, remoteClientId: string) {
  const db = await dbPromise;
  await db.runAsync(
    `UPDATE clients_queue
     SET sync_status = 'SYNCED', last_error = NULL, remote_client_id = ?
     WHERE local_client_id = ?`,
    [remoteClientId, localClientId]
  );
}

export async function markClientAsFailed(localClientId: string, error: string) {
  const db = await dbPromise;
  await db.runAsync(
    `UPDATE clients_queue
     SET sync_status = 'FAILED', last_error = ?
     WHERE local_client_id = ?`,
    [error, localClientId]
  );
}

export async function replaceVisitClientId(localClientId: string, remoteClientId: string, remoteName: string) {
  const db = await dbPromise;
  await db.runAsync(
    `UPDATE visits_queue
     SET client_id = ?, client_name = ?
     WHERE client_id = ?`,
    [remoteClientId, remoteName, localClientId]
  );
}

export async function setSetting(key: string, value: string) {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await dbPromise;
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = ?`,
    [key]
  );
  return row?.value ?? null;
}

export async function replaceClientsCache(sellerId: string, clients: ClientItem[]) {
  const db = await dbPromise;
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM clients_cache WHERE seller_id = ?`, [sellerId]);
    for (const client of clients) {
      await db.runAsync(
        `INSERT INTO clients_cache (id, seller_id, name, ghl_contact_id)
         VALUES (?, ?, ?, ?)`,
        [client.id, sellerId, client.name, client.ghlContactId ?? null]
      );
    }
  });
}

export async function upsertClientCache(sellerId: string, client: ClientItem) {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT INTO clients_cache (id, seller_id, name, ghl_contact_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       seller_id = excluded.seller_id,
       name = excluded.name,
       ghl_contact_id = excluded.ghl_contact_id`,
    [client.id, sellerId, client.name, client.ghlContactId ?? null]
  );
}

export async function getCachedClients(sellerId: string): Promise<ClientItem[]> {
  const db = await dbPromise;
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    ghl_contact_id: string | null;
  }>(
    `SELECT id, name, ghl_contact_id
     FROM clients_cache
     WHERE seller_id = ?
     ORDER BY name ASC`,
    [sellerId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ghlContactId: row.ghl_contact_id
  }));
}
