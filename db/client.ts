// Use require() to avoid Vite's ESM module resolution issues with node: modules
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

let db: ReturnType<typeof DatabaseSync> | null = null;

export function getDb(): ReturnType<typeof DatabaseSync> {
  if (db) return db;
  const dbPath = process.env.DB_PATH || "./data/ml-dashboard.db";
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
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
