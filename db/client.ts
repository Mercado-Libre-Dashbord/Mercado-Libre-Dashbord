// Use require() to avoid Vite's ESM module resolution issues with node: modules
import type { DatabaseSync } from "node:sqlite";
const sqlite = require("node:sqlite") as typeof import("node:sqlite");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = process.env.DB_PATH || "./data/ml-dashboard.db";
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new sqlite.DatabaseSync(dbPath);
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

// For testing purposes - close and reset the database connection
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
