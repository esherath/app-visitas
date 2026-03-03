import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, signAccessToken } from "@/lib/auth";
import { RegisterSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = RegisterSchema.parse(body);
    const email = payload.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (existing) {
      return NextResponse.json({ ok: false, message: "Email already in use" }, { status: 409 });
    }

    const passwordHash = await hashPassword(payload.password);

    const user = await prisma.user.create({
      data: {
        name: payload.name.trim(),
        email,
        passwordHash,
        role: "SELLER"
      },
      select: { id: true, name: true, email: true, role: true, ghlUserId: true }
    });

    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    return NextResponse.json({ ok: true, token, user });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 }
    );
  }
}
