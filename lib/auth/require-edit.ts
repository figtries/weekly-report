import { getSession } from './get-session';

export async function requireEdit(): Promise<{ userId: string; email: string }> {
  const session = await getSession();
  if (!session) throw Object.assign(new Error('Sign in first.'), { status: 401 });
  return session;
}
