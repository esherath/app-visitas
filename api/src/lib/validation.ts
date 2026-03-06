import { z } from "zod";

export const VisitSyncItemSchema = z.object({
  localVisitId: z.string().min(1),
  sellerId: z.string().min(1).optional(),
  clientId: z.string().min(1),
  clientName: z.string().min(1).optional(),
  clientEmail: z.string().email().optional(),
  clientPhone: z.string().min(3).optional(),
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
  localClientId: z.string().min(1).optional(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(3).optional(),
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
  password: z.string().min(6),
  organizationSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/)
    .optional()
});

export const LoginSchema = z.object({
  accessMode: z.enum(["COMPANY", "MASTER"]).default("COMPANY"),
  organizationSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/)
    .optional(),
  login: z.string().trim().min(3).max(80),
  password: z.string().min(6)
});

export const CreateOrganizationSchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/),
  logoUrl: z.string().url().optional(),
  ghlApiBaseUrl: z.string().url().optional(),
  ghlLocationId: z.string().min(3).optional(),
  ghlAccessToken: z.string().min(10).optional(),
  ghlContactSyncMaxPages: z.number().int().min(1).max(2000).optional(),
  ghlVisitsObjectKey: z.string().min(2).optional(),
  ghlVisitsFieldClientNameKey: z.string().min(2).optional(),
  ghlVisitsFieldOwnerKey: z.string().min(2).optional(),
  ghlVisitsFieldVisitDateKey: z.string().min(2).optional(),
  ghlVisitsFieldNotesKey: z.string().min(2).optional(),
  ghlVisitsFieldTitleKey: z.string().min(2).optional(),
  adminUser: z
    .object({
      name: z.string().min(2),
      email: z.string().email(),
      username: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9._-]{3,40}$/)
        .optional(),
      password: z.string().min(6)
    })
    .optional()
});
