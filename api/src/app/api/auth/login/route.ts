import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LoginSchema } from "@/lib/validation";
import { signAccessToken, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = LoginSchema.parse(body);
    const login = payload.login.toLowerCase().trim();
    const organizationSlug = payload.organizationSlug?.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: login.includes("@") ? { email: login } : { username: login },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        role: true,
        ghlUserId: true,
        passwordHash: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true
          }
        }
      }
    });

    if (!user?.passwordHash) {
      return NextResponse.json({ ok: false, message: "Invalid credentials" }, { status: 401 });
    }
    if (!user.organizationId) {
      return NextResponse.json(
        { ok: false, message: "User has no organization linked. Contact administrator." },
        { status: 400 }
      );
    }

    const valid = await verifyPassword(payload.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ ok: false, message: "Invalid credentials" }, { status: 401 });
    }

    if (payload.accessMode === "MASTER") {
      if (user.role !== "SUPER_ADMIN") {
        return NextResponse.json(
          { ok: false, message: "Master access is restricted." },
          { status: 403 }
        );
      }
    } else {
      if (!organizationSlug) {
        return NextResponse.json(
          { ok: false, message: "organizationSlug is required for company access." },
          { status: 400 }
        );
      }
      if (user.role === "SUPER_ADMIN") {
        return NextResponse.json(
          { ok: false, message: "Use master access for this account." },
          { status: 403 }
        );
      }
      if (user.organization?.slug !== organizationSlug) {
        return NextResponse.json({ ok: false, message: "Invalid company access." }, { status: 401 });
      }
    }

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
