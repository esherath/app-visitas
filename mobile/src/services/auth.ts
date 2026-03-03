import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "auth_token";

function withBase(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  ghlUserId?: string | null;
};

type AuthResponse = {
  ok: boolean;
  token: string;
  user: AuthUser;
};

export async function saveAuthToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getAuthToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearAuthToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function login(
  apiBaseUrl: string,
  payload: { email: string; password: string }
): Promise<AuthResponse> {
  const response = await fetch(withBase(apiBaseUrl, "/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }
  return (await response.json()) as AuthResponse;
}

export async function register(
  apiBaseUrl: string,
  payload: { name: string; email: string; password: string }
): Promise<AuthResponse> {
  const response = await fetch(withBase(apiBaseUrl, "/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Register failed: ${response.status}`);
  }
  return (await response.json()) as AuthResponse;
}

export async function me(apiBaseUrl: string, token: string): Promise<AuthUser> {
  const response = await fetch(withBase(apiBaseUrl, "/api/auth/me"), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`Auth me failed: ${response.status}`);
  }
  const json = (await response.json()) as { user: AuthUser };
  return json.user;
}

export async function updateMyGhlUserId(
  apiBaseUrl: string,
  token: string,
  ghlUserId: string
): Promise<AuthUser> {
  const response = await fetch(withBase(apiBaseUrl, "/api/auth/me"), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ ghlUserId })
  });
  if (!response.ok) {
    throw new Error(`Update profile failed: ${response.status}`);
  }
  const json = (await response.json()) as { user: AuthUser };
  return json.user;
}
