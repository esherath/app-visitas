import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, signAccessToken } from "@/lib/auth";
import { RegisterSchema } from "@/lib/validation";

function deriveUsernameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? email;
  const normalized = localPart
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");

  return normalized || `user-${Date.now()}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = RegisterSchema.parse(body);
    const email = payload.email.toLowerCase().trim();
    const username = deriveUsernameFromEmail(email);

    const [existingEmail, existingUsername] = await Promise.all([
      prisma.user.findUnique({
        where: { email },
        select: { id: true }
      }),
      prisma.user.findUnique({
        where: { username },
        select: { id: true }
      })
    ]);

    if (existingEmail) {
      return NextResponse.json({ ok: false, message: "Email already in use" }, { status: 409 });
    }
    if (existingUsername) {
      return NextResponse.json({ ok: false, message: "Login already in use" }, { status: 409 });
    }

    const passwordHash = await hashPassword(payload.password);

    let organizationId: string;
    if (payload.organizationSlug) {
      const organization = await prisma.organization.findUnique({
        where: { slug: payload.organizationSlug },
        select: { id: true }
      });
      if (!organization) {
        return NextResponse.json({ ok: false, message: "Organization not found" }, { status: 404 });
      }
      organizationId = organization.id;
    } else {
      const organizations = await prisma.organization.findMany({
        select: { id: true },
        take: 2
      });
      if (organizations.length !== 1) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "organizationSlug is required when there is more than one organization"
          },
          { status: 400 }
        );
      }
      organizationId = organizations[0].id;
    }

    const user = await prisma.user.create({
      data: {
        name: payload.name.trim(),
        email,
        username,
        passwordHash,
        role: "SELLER",
        organizationId
      },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        role: true,
        ghlUserId: true,
        organizationId: true,
        organization: {
          select: {
            name: true,
            slug: true,
            logoUrl: true
          }
        }
      }
    });

    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId
    });

    return NextResponse.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
        ghlUserId: user.ghlUserId,
        organizationId: user.organizationId,
        organizationName: user.organization?.name ?? null,
        organizationSlug: user.organization?.slug ?? null,
        organizationLogoUrl: user.organization?.logoUrl ?? null
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}
