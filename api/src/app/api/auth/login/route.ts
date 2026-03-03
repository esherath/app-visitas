import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LoginSchema } from "@/lib/validation";
import { signAccessToken, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = LoginSchema.parse(body);
    const email = payload.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, role: true, ghlUserId: true, passwordHash: true }
    });

    if (!user?.passwordHash) {
      return NextResponse.json({ ok: false, message: "Invalid credentials" }, { status: 401 });
    }

    const valid = await verifyPassword(payload.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ ok: false, message: "Invalid credentials" }, { status: 401 });
    }

    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    return NextResponse.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        ghlUserId: user.ghlUserId
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}
