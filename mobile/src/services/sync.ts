import NetInfo from "@react-native-community/netinfo";
import {
  getPendingClients,
  getVisitByLocalVisitId,
  getPendingVisits,
  markClientAsFailed,
  markClientAsSynced,
  markVisitAsPending,
  markVisitAsFailed,
  markVisitAsSynced,
  replaceVisitClientId
} from "../db/database";
import { createClient, syncVisitsToApi } from "./api";

export async function syncPendingClients(apiBaseUrl: string, token: string) {
  const netInfo = await NetInfo.fetch();
  if (!netInfo.isConnected) {
    return { synced: 0, failed: 0, skipped: true };
  }

  const pendingClients = await getPendingClients(100);
  if (!pendingClients.length) {
    return { synced: 0, failed: 0, skipped: false };
  }

  let synced = 0;
  let failed = 0;

  for (const client of pendingClients) {
    try {
      const remoteClient = await createClient(
        { apiBaseUrl, token },
        {
          name: client.name,
          email: client.email ?? undefined,
          phone: client.phone ?? undefined,
          localClientId: client.localClientId
        }
      );

      await replaceVisitClientId(client.localClientId, remoteClient.id, remoteClient.name);
      await markClientAsSynced(client.localClientId, remoteClient.id);
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao sincronizar cliente";
      await markClientAsFailed(client.localClientId, message);
      failed += 1;
    }
  }

  return { synced, failed, skipped: false };
}

export async function syncPendingVisits(apiBaseUrl: string, token: string) {
  const netInfo = await NetInfo.fetch();
  if (!netInfo.isConnected) {
    return { synced: 0, failed: 0, skipped: true };
  }

  await syncPendingClients(apiBaseUrl, token);

  const pending = await getPendingVisits(100);
  if (!pending.length) {
    return { synced: 0, failed: 0, skipped: false };
  }

  try {
    const payload = await syncVisitsToApi({ apiBaseUrl, token }, {
      visits: pending.map((item) => ({
        localVisitId: item.localVisitId,
        clientId: item.clientId,
        clientName: item.clientName ?? undefined,
        clientEmail: item.clientEmail ?? undefined,
        clientPhone: item.clientPhone ?? undefined,
        notes: item.notes,
        checkInAt: item.checkInAt,
        latitude: item.latitude,
        longitude: item.longitude,
        accuracyMeters: item.accuracyMeters ?? undefined
      }))
    });

    let synced = 0;
    let failed = 0;

    for (const result of payload.results) {
      if (result.success) {
        await markVisitAsSynced(result.localVisitId);
        synced += 1;
      } else {
        await markVisitAsFailed(result.localVisitId, result.error ?? "sync failed");
        failed += 1;
      }
    }

    return { synced, failed, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    for (const item of pending) {
      await markVisitAsFailed(item.localVisitId, message);
    }
    return { synced: 0, failed: pending.length, skipped: false };
  }
}

export async function retryVisitSync(localVisitId: string, apiBaseUrl: string, token: string) {
  const netInfo = await NetInfo.fetch();
  if (!netInfo.isConnected) {
    return { success: false, error: "Sem conexao com a internet." };
  }

  await syncPendingClients(apiBaseUrl, token);

  const visit = await getVisitByLocalVisitId(localVisitId);
  if (!visit) {
    return { success: false, error: "Visita nao encontrada na fila local." };
  }

  await markVisitAsPending(localVisitId);

  try {
    const payload = await syncVisitsToApi({ apiBaseUrl, token }, {
      visits: [
        {
          localVisitId: visit.localVisitId,
          clientId: visit.clientId,
          clientName: visit.clientName ?? undefined,
          clientEmail: visit.clientEmail ?? undefined,
          clientPhone: visit.clientPhone ?? undefined,
          notes: visit.notes,
          checkInAt: visit.checkInAt,
          latitude: visit.latitude,
          longitude: visit.longitude,
          accuracyMeters: visit.accuracyMeters ?? undefined
        }
      ]
    });

    const result = payload.results[0];
    if (!result || !result.success) {
      const message = result?.error ?? "Falha no sync";
      await markVisitAsFailed(localVisitId, message);
      return { success: false, error: message };
    }

    await markVisitAsSynced(localVisitId);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no sync";
    await markVisitAsFailed(localVisitId, message);
    return { success: false, error: message };
  }
}
