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
  // node:sqlite enables FK enforcement by default (unlike most SQLite drivers,
  // where it's opt-in via PRAGMA). The schema's REFERENCES clauses are for
  // documentation/intent; sync writes products and order_items independently
  // and doesn't guarantee insert ordering across those tables, so enforcement
  // is disabled to match the behavior the rest of the codebase assumes.
  db = new sqlite.DatabaseSync(dbPath, { enableForeignKeyConstraints: false });
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
