import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";

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
  created_at: string;
}

function mapRow(row: unknown): Account {
  const r = row as AccountRow;
  return { id: r.id, name: r.name, ownerEmail: r.owner_email, mlSellerId: r.ml_seller_id, createdAt: r.created_at };
}

export async function createAccount(db: Client, name: string, ownerEmail: string): Promise<Account> {
  const id = nanoid(12);
  const createdAt = new Date().toISOString();
  const normalizedEmail = ownerEmail.trim().toLowerCase();
  await db.execute({
    sql: `INSERT INTO accounts (id, name, owner_email, ml_seller_id, created_at) VALUES (?, ?, ?, NULL, ?)`,
    args: [id, name, normalizedEmail, createdAt],
  });
  return { id, name, ownerEmail: normalizedEmail, mlSellerId: null, createdAt };
}

export async function listAccounts(db: Client): Promise<Account[]> {
  const result = await db.execute("SELECT * FROM accounts ORDER BY created_at ASC");
  return result.rows.map(mapRow);
}

export async function getAccountById(db: Client, id: string): Promise<Account | null> {
  const result = await db.execute({ sql: "SELECT * FROM accounts WHERE id = ?", args: [id] });
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function getAccountByOwnerEmail(db: Client, email: string): Promise<Account | null> {
  const result = await db.execute({
    sql: "SELECT * FROM accounts WHERE owner_email = ?",
    args: [email.trim().toLowerCase()],
  });
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function setAccountMlSellerId(db: Client, accountId: string, mlSellerId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE accounts SET ml_seller_id = ? WHERE id = ?",
    args: [mlSellerId, accountId],
  });
}
