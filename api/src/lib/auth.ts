import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";

type TokenPayload = {
  userId: string;
  email: string;
  role: string;
  organizationId: string;
};

const JWT_SECRET = process.env.JWT_SECRET;

function getSecret() {
  if (!JWT_SECRET) {
    throw new Error("Missing JWT_SECRET env var");
  }
  return JWT_SECRET;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAccessToken(payload: TokenPayload) {
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, getSecret());
  const payload = decoded as Partial<TokenPayload>;
  if (
    !payload ||
    typeof payload.userId !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.organizationId !== "string"
  ) {
    throw new Error("Invalid token payload");
  }
  return payload as TokenPayload;
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ ok: false, message }, { status: 401 });
}

export function extractBearerToken(request: Request) {
  const value = request.headers.get("authorization");
  if (!value || !value.startsWith("Bearer ")) {
    return null;
  }
  return value.slice(7).trim();
}

export function requireAuth(request: Request): TokenPayload | null {
  const token = extractBearerToken(request);
  if (!token) {
    return null;
  }
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

export function hasRole(auth: TokenPayload | null, role: string) {
  if (!auth) {
    return false;
  }
  return auth.role.toUpperCase() === role.toUpperCase();
}

export function hasAnyRole(auth: TokenPayload | null, roles: string[]) {
  if (!auth) {
    return false;
  }
  const authRole = auth.role.toUpperCase();
  return roles.some((role) => authRole === role.toUpperCase());
}
