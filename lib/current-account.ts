import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getDb } from "@/db/client";
import { getAccountByOwnerEmail, listAccounts, type Account } from "@/db/accounts";

export const CURRENT_ACCOUNT_COOKIE = "current_account_id";

export interface CurrentUser {
  email: string;
  isAdmin: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return { email, isAdmin: session?.user?.isAdmin === true };
}

/**
 * Resolves which account the current request should operate on.
 * Clients (non-admins) always see their own account, looked up by owner
 * email — never trust the cookie for them. Admins can browse any account,
 * picked via the `current_account_id` cookie set by the account switcher.
 */
export async function resolveCurrentAccount(): Promise<Account | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = await getDb();

  if (!user.isAdmin) {
    return getAccountByOwnerEmail(db, user.email);
  }

  const accounts = await listAccounts(db);
  if (accounts.length === 0) return null;
  const selectedId = cookies().get(CURRENT_ACCOUNT_COOKIE)?.value;
  const selected = selectedId ? accounts.find((a) => a.id === selectedId) : undefined;
  return selected ?? accounts[0];
}
