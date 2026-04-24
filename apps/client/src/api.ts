import type { AuthResponse, AuthUser } from '@krunker-arena/shared';

export async function register(username: string, password: string, displayName: string): Promise<AuthUser> {
  return authRequest('/api/auth/register', { username, password, displayName });
}

export async function login(username: string, password: string): Promise<AuthUser> {
  return authRequest('/api/auth/login', { username, password });
}

export async function currentUser(): Promise<AuthUser | null> {
  const response = await fetch('/api/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Impossible de charger la session');
  return ((await response.json()) as AuthResponse).user;
}

async function authRequest(path: string, body: unknown): Promise<AuthUser> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Erreur auth');
  return ((await response.json()) as AuthResponse).user;
}
