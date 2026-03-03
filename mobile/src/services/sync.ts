import NetInfo from "@react-native-community/netinfo";
import {
  getVisitByLocalVisitId,
  getPendingVisits,
  markVisitAsPending,
  markVisitAsFailed,
  markVisitAsSynced
} from "../db/database";
import { syncVisitsToApi } from "./api";

export async function syncPendingVisits(apiBaseUrl: string, token: string) {
  const netInfo = await NetInfo.fetch();
  if (!netInfo.isConnected) {
    return { synced: 0, failed: 0, skipped: true };
  }

  const pending = await getPendingVisits(100);
  if (!pending.length) {
    return { synced: 0, failed: 0, skipped: false };
  }

  try {
    const payload = await syncVisitsToApi({ apiBaseUrl, token }, {
      visits: pending.map((item) => ({
        localVisitId: item.localVisitId,
        clientId: item.clientId,
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
