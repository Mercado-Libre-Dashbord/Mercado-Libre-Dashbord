import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function resolveUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const dbPath = process.env.DB_PATH || "./data/ml-dashboard.db";
  const dir = path.dirname(dbPath);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
  return `file:${dbPath}`;
}

async function applySchema(db: Client): Promise<void> {
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf-8");
  await db.executeMultiple(schema);
}

export async function getDb(): Promise<Client> {
  if (!client) {
    client = createClient({
      url: resolveUrl(),
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
  }
  if (!schemaReady) {
    schemaReady = applySchema(client);
  }
  await schemaReady;
  return client;
}

// For testing purposes - close and reset the database connection
export function closeDb(): void {
  if (client) {
    client.close();
    client = null;
    schemaReady = null;
  }
}
