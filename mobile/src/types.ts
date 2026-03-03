export type PendingVisit = {
  id: number;
  localVisitId: string;
  sellerId: string;
  clientId: string;
  clientName?: string | null;
  notes: string;
  checkInAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  syncStatus: "PENDING" | "SYNCED" | "FAILED";
  lastError?: string | null;
};

export type NewVisitInput = Omit<PendingVisit, "id" | "syncStatus" | "lastError">;

export type ClientItem = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  ghlContactId?: string | null;
  latestOpportunity?: {
    title?: string | null;
    stageName?: string | null;
    status?: string | null;
  } | null;
};
