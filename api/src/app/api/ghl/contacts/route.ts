import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, unauthorized } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth) {
    return unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  const contacts = await prisma.ghlContact.findMany({
    where: {
      sellerId: auth.userId,
      name: query
        ? {
            contains: query,
            mode: "insensitive"
          }
        : undefined
    },
    orderBy: { name: "asc" },
    take: Number.isFinite(limit) && limit > 0 ? limit : 200,
    select: {
      ghlContactId: true,
      name: true,
      email: true,
      phone: true
    }
  });

  return NextResponse.json({
    contacts: contacts.map((item) => ({
      id: item.ghlContactId,
      name: item.name,
      email: item.email,
      phone: item.phone
    }))
  });
}
