import { z } from "zod";

export const VisitSyncItemSchema = z.object({
  localVisitId: z.string().min(1),
  sellerId: z.string().min(1).optional(),
  clientId: z.string().min(1),
  notes: z.string().min(1),
  checkInAt: z.string().datetime(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().positive().optional()
});

export const SyncRequestSchema = z.object({
  visits: z.array(VisitSyncItemSchema).min(1)
});

export const CreateClientSchema = z.object({
  sellerId: z.string().min(1).optional(),
  name: z.string().min(1),
  externalRef: z.string().min(1).optional(),
  ghlContactId: z.string().min(1).optional()
});

export const UpdateClientSchema = z.object({
  clientId: z.string().min(1),
  ghlContactId: z.string().min(1)
});

export const RegisterSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6)
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});
