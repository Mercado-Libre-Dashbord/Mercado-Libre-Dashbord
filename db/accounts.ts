import { nanoid } from "nanoid";
import type { QueryExecutor } from "./client";

export interface Account {
  id: string;
  name: string;
  ownerEmail: string;
  mlSellerId: string | null;
  createdAt: string;
}

interface AccountRow {
  id: string;
  name: string;
  owner_email: string;
  ml_seller_id: string | null;
  created_at: string | Date;
}

function mapRow(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    ownerEmail: row.owner_email,
    mlSellerId: row.ml_seller_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function createAccount(db: QueryExecutor, name: string, ownerEmail: string): Promise<Account> {
  const id = nanoid(12);
  const createdAt = new Date().toISOString();
  const normalizedEmail = ownerEmail.trim().toLowerCase();
  await db.query(
    `INSERT INTO accounts (id, name, owner_email, ml_seller_id, created_at) VALUES ($1, $2, $3, NULL, $4)`,
    [id, name, normalizedEmail, createdAt]
  );
  return { id, name, ownerEmail: normalizedEmail, mlSellerId: null, createdAt };
}

export async function listAccounts(db: QueryExecutor): Promise<Account[]> {
  const result = await db.query<AccountRow>("SELECT * FROM accounts ORDER BY created_at ASC");
  return result.rows.map(mapRow);
}

export async function getAccountById(db: QueryExecutor, id: string): Promise<Account | null> {
  const result = await db.query<AccountRow>("SELECT * FROM accounts WHERE id = $1", [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function getAccountByOwnerEmail(db: QueryExecutor, email: string): Promise<Account | null> {
  const result = await db.query<AccountRow>("SELECT * FROM accounts WHERE owner_email = $1", [
    email.trim().toLowerCase(),
  ]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function setAccountMlSellerId(db: QueryExecutor, accountId: string, mlSellerId: string): Promise<void> {
  await db.query("UPDATE accounts SET ml_seller_id = $1 WHERE id = $2", [mlSellerId, accountId]);
}
