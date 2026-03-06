import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, hasAnyRole, requireAuth, unauthorized } from "@/lib/auth";
import { CreateOrganizationSchema } from "@/lib/validation";

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function deriveUsernameFromAdmin(input: { email: string; username?: string }) {
  const baseValue = input.username?.trim() || input.email.split("@")[0] || input.email;
  const normalized = baseValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");

  return normalized || "admin";
}

function mapOrganizationResponse(organization: {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  ghlApiBaseUrl: string | null;
  ghlLocationId: string | null;
  ghlAccessToken?: string | null;
  ghlContactSyncMaxPages: number | null;
  ghlVisitsObjectKey: string | null;
  ghlVisitsFieldClientNameKey: string | null;
  ghlVisitsFieldOwnerKey: string | null;
  ghlVisitsFieldVisitDateKey: string | null;
  ghlVisitsFieldNotesKey: string | null;
  ghlVisitsFieldTitleKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    users?: number;
  };
}) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logoUrl: organization.logoUrl,
    ghlApiBaseUrl: organization.ghlApiBaseUrl,
    ghlLocationId: organization.ghlLocationId,
    hasGhlAccessToken: Boolean(organization.ghlAccessToken),
    ghlContactSyncMaxPages: organization.ghlContactSyncMaxPages,
    ghlVisitsObjectKey: organization.ghlVisitsObjectKey,
    ghlVisitsFieldClientNameKey: organization.ghlVisitsFieldClientNameKey,
    ghlVisitsFieldOwnerKey: organization.ghlVisitsFieldOwnerKey,
    ghlVisitsFieldVisitDateKey: organization.ghlVisitsFieldVisitDateKey,
    ghlVisitsFieldNotesKey: organization.ghlVisitsFieldNotesKey,
    ghlVisitsFieldTitleKey: organization.ghlVisitsFieldTitleKey,
    usersCount: organization._count?.users ?? undefined,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt
  };
}

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth || !hasAnyRole(auth, ["MASTER", "SUPER_ADMIN"])) {
    return unauthorized("Only master/super admin can access organizations");
  }

  const organizations = await prisma.organization.findMany({
    where: auth?.role === "SUPER_ADMIN" ? undefined : { id: auth.organizationId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: {
        select: {
          users: true
        }
      }
    }
  });

  return NextResponse.json({
    organizations: organizations.map(mapOrganizationResponse)
  });
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth || !hasAnyRole(auth, ["SUPER_ADMIN"])) {
    return unauthorized("Only super admin can create organizations");
  }

  try {
    const body = await request.json();
    const payload = CreateOrganizationSchema.parse(body);

    const existingSlug = await prisma.organization.findUnique({
      where: { slug: payload.slug },
      select: { id: true }
    });
    if (existingSlug) {
      return NextResponse.json({ ok: false, message: "Slug already in use" }, { status: 409 });
    }

    if (payload.adminUser?.email) {
      const normalizedEmail = payload.adminUser.email.toLowerCase().trim();
      const normalizedUsername = deriveUsernameFromAdmin(payload.adminUser);
      const [existingEmail, existingUsername] = await Promise.all([
        prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true }
        }),
        prisma.user.findUnique({
          where: { username: normalizedUsername },
          select: { id: true }
        })
      ]);
      if (existingEmail) {
        return NextResponse.json(
          { ok: false, message: "Admin email already in use" },
          { status: 409 }
        );
      }
      if (existingUsername) {
        return NextResponse.json(
          { ok: false, message: "Admin login already in use" },
          { status: 409 }
        );
      }
    }

    const organization = await prisma.organization.create({
      data: {
        name: payload.name.trim(),
        slug: payload.slug,
        logoUrl: normalizeText(payload.logoUrl),
        ghlApiBaseUrl: normalizeText(payload.ghlApiBaseUrl),
        ghlLocationId: normalizeText(payload.ghlLocationId),
        ghlAccessToken: normalizeText(payload.ghlAccessToken),
        ghlContactSyncMaxPages: payload.ghlContactSyncMaxPages ?? null,
        ghlVisitsObjectKey: normalizeText(payload.ghlVisitsObjectKey),
        ghlVisitsFieldClientNameKey: normalizeText(payload.ghlVisitsFieldClientNameKey),
        ghlVisitsFieldOwnerKey: normalizeText(payload.ghlVisitsFieldOwnerKey),
        ghlVisitsFieldVisitDateKey: normalizeText(payload.ghlVisitsFieldVisitDateKey),
        ghlVisitsFieldNotesKey: normalizeText(payload.ghlVisitsFieldNotesKey),
        ghlVisitsFieldTitleKey: normalizeText(payload.ghlVisitsFieldTitleKey)
      }
    });

    let adminUser:
      | {
          id: string;
          name: string;
          email: string;
          role: string;
          organizationId: string;
        }
      | undefined;
    if (payload.adminUser) {
      const passwordHash = await hashPassword(payload.adminUser.password);
      const username = deriveUsernameFromAdmin(payload.adminUser);
      adminUser = await prisma.user.create({
        data: {
          name: payload.adminUser.name.trim(),
          email: payload.adminUser.email.toLowerCase().trim(),
          username,
          passwordHash,
          role: "MASTER",
          organizationId: organization.id
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          organizationId: true
        }
      });
    }

    return NextResponse.json({
      ok: true,
      organization: mapOrganizationResponse(organization),
      adminUser
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = requireAuth(request);
  if (!auth || !hasAnyRole(auth, ["MASTER", "SUPER_ADMIN"])) {
    return unauthorized("Only master/super admin can update organizations");
  }

  try {
    const body = (await request.json()) as {
      organizationId?: string;
      name?: string;
      slug?: string;
      logoUrl?: string | null;
      ghlApiBaseUrl?: string | null;
      ghlLocationId?: string | null;
      ghlAccessToken?: string | null;
      ghlContactSyncMaxPages?: number | null;
      ghlVisitsObjectKey?: string | null;
      ghlVisitsFieldClientNameKey?: string | null;
      ghlVisitsFieldOwnerKey?: string | null;
      ghlVisitsFieldVisitDateKey?: string | null;
      ghlVisitsFieldNotesKey?: string | null;
      ghlVisitsFieldTitleKey?: string | null;
    };

    const organizationId = body.organizationId?.trim();
    if (!organizationId) {
      return NextResponse.json({ ok: false, message: "organizationId is required" }, { status: 400 });
    }

    const existing = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true }
    });
    if (!existing) {
      return NextResponse.json({ ok: false, message: "Organization not found" }, { status: 404 });
    }
    if (auth.role !== "SUPER_ADMIN" && existing.id !== auth.organizationId) {
      return unauthorized("Organization belongs to another account");
    }

    const nextSlug = body.slug?.trim().toLowerCase();
    if (auth.role !== "SUPER_ADMIN" && nextSlug && nextSlug !== existing.slug) {
      return unauthorized("Only super admin can change organization slug");
    }
    if (nextSlug && nextSlug !== existing.slug) {
      const slugInUse = await prisma.organization.findUnique({
        where: { slug: nextSlug },
        select: { id: true }
      });
      if (slugInUse) {
        return NextResponse.json({ ok: false, message: "Slug already in use" }, { status: 409 });
      }
    }

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: body.name?.trim() || undefined,
        slug: nextSlug || undefined,
        logoUrl: body.logoUrl === undefined ? undefined : normalizeText(body.logoUrl),
        ghlApiBaseUrl:
          body.ghlApiBaseUrl === undefined ? undefined : normalizeText(body.ghlApiBaseUrl),
        ghlLocationId:
          body.ghlLocationId === undefined ? undefined : normalizeText(body.ghlLocationId),
        ghlAccessToken:
          body.ghlAccessToken === undefined ? undefined : normalizeText(body.ghlAccessToken),
        ghlContactSyncMaxPages:
          body.ghlContactSyncMaxPages === undefined
            ? undefined
            : body.ghlContactSyncMaxPages || null,
        ghlVisitsObjectKey:
          body.ghlVisitsObjectKey === undefined
            ? undefined
            : normalizeText(body.ghlVisitsObjectKey),
        ghlVisitsFieldClientNameKey:
          body.ghlVisitsFieldClientNameKey === undefined
            ? undefined
            : normalizeText(body.ghlVisitsFieldClientNameKey),
        ghlVisitsFieldOwnerKey:
          body.ghlVisitsFieldOwnerKey === undefined
            ? undefined
            : normalizeText(body.ghlVisitsFieldOwnerKey),
        ghlVisitsFieldVisitDateKey:
          body.ghlVisitsFieldVisitDateKey === undefined
            ? undefined
            : normalizeText(body.ghlVisitsFieldVisitDateKey),
        ghlVisitsFieldNotesKey:
          body.ghlVisitsFieldNotesKey === undefined
            ? undefined
            : normalizeText(body.ghlVisitsFieldNotesKey),
        ghlVisitsFieldTitleKey:
          body.ghlVisitsFieldTitleKey === undefined
            ? undefined
            : normalizeText(body.ghlVisitsFieldTitleKey)
      },
      include: {
        _count: {
          select: {
            users: true
          }
        }
      }
    });

    return NextResponse.json({
      ok: true,
      organization: mapOrganizationResponse(updated)
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}
