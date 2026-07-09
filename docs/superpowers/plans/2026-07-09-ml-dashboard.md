# Dashboard de Rentabilidad ML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js app that syncs product/order/ads data from Mercado Libre through an embedded MCP server, lets the owner load a final cost per product, and computes real profitability per product and per account, with historical trend views.

**Architecture:** Single Next.js project. `mcp/tools.ts` holds plain async functions that call the ML REST API (via `mcp/ml-client.ts`) — these are registered as MCP tools on an `McpServer` instance (`mcp/server.ts`) so the integration is genuinely MCP-based and could later be exposed over HTTP for Claude Desktop. For v1, `sync/sync-service.ts` calls the tool functions directly (in-process) to avoid pointless JSON-RPC round-trips, and persists results — including a precomputed `net_profit` per order line — into a local SQLite database. Next.js API routes expose that data to a plain React UI.

**Tech Stack:** Next.js 14 (App Router, TypeScript), better-sqlite3, @modelcontextprotocol/sdk, zod, recharts, vitest.

## Global Constraints

- Site: Mercado Libre Argentina (MLA). OAuth authorize URL: `https://auth.mercadolibre.com.ar/authorization`. Token URL: `https://api.mercadolibre.com/oauth/token`.
- Local-only app. No hosting/deploy. `.env` and the SQLite file are git-ignored, never committed.
- Cost is a single "final cost" number per product (no COGS/packaging/tax breakdown) — per spec's explicit decision.
- Costs are versioned by `valid_from` date and never overwritten; a new cost entry is always an INSERT. A sale's `cost_applied` must use the cost that was valid on the order's `date_created`, not the latest cost.
- If a product has no cost entry valid at the sale date, `cost_applied` and `net_profit` stay `NULL` — never assume cost `$0`.
- `net_profit` is computed and persisted at sync time, not recomputed on every page render.
- Testing scope (explicit spec decision): thorough unit tests for the profitability calculation logic and the sync orchestration; lighter/happy-path tests for API routes; no e2e suite and no mandatory coverage threshold for UI code.
- Package manager: npm. Test runner: vitest. Path alias `@/*` → project root.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `start`, `test`; path alias `@/*` usable by every later task; a minimal home page so `next build` succeeds.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ml-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "better-sqlite3": "^11.3.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0",
    "recharts": "^2.12.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/better-sqlite3": "^7.6.0",
    "vitest": "^2.0.0",
    "vite-tsconfig-paths": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.next/
data/
.env
*.tsbuildinfo
```

- [ ] **Step 6: Create `.env.example`**

```
ML_CLIENT_ID=
ML_CLIENT_SECRET=
ML_REDIRECT_URI=http://localhost:3000/api/auth/callback
ML_SELLER_ID=
DB_PATH=./data/ml-dashboard.db
```

- [ ] **Step 7: Create `app/globals.css`**

```css
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; margin: 0; background: #f5f6f8; color: #1a1a1a; }
main { max-width: 1100px; margin: 0 auto; padding: 24px; }
nav { display: flex; gap: 16px; padding: 16px 24px; background: #1a1a2e; }
nav a { color: #fff; text-decoration: none; font-weight: 500; }
table { width: 100%; border-collapse: collapse; background: #fff; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e2e2e2; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
.kpi-card { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.kpi-card .value { font-size: 24px; font-weight: 700; }
.missing-cost { color: #b00020; font-weight: 600; }
```

- [ ] **Step 8: Create `app/layout.tsx`**

```tsx
import "./globals.css";

export const metadata = { title: "Dashboard Rentabilidad ML" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <nav>
          <a href="/">Resumen</a>
          <a href="/productos">Productos</a>
          <a href="/ventas">Ventas</a>
          <a href="/tendencias">Tendencias</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Create placeholder `app/page.tsx`**

```tsx
export default function HomePage() {
  return <p>Cargando...</p>;
}
```

(This gets replaced with the real Resumen page in Task 10.)

- [ ] **Step 10: Install dependencies**

Run: `npm install`
Expected: installs without errors (better-sqlite3 compiles its native binding — if it fails, install `node-gyp` build tools per the error message).

- [ ] **Step 11: Verify the scaffold builds**

Run: `npm run build`
Expected: `Compiled successfully`

- [ ] **Step 12: Commit**

```bash
git add package.json tsconfig.json next.config.mjs vitest.config.ts .gitignore .env.example app
git commit -m "chore: scaffold Next.js project"
```

---

### Task 2: SQLite data layer

**Files:**
- Create: `db/schema.sql`
- Create: `db/client.ts`
- Create: `db/client.test.ts`
- Create: `db/tokens.ts`
- Create: `db/tokens.test.ts`

**Interfaces:**
- Produces: `getDb(): Database.Database` (opens/creates the SQLite file at `process.env.DB_PATH`, applies schema); `saveTokens(db, tokens: AuthTokens): void`; `getTokens(db): AuthTokens | null`; type `AuthTokens = { accessToken: string; refreshToken: string; expiresAt: string }`.

- [ ] **Step 1: Create `db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sku TEXT,
  current_price REAL,
  stock INTEGER,
  permalink TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  cost REAL NOT NULL,
  valid_from TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  date_created TEXT NOT NULL,
  status TEXT NOT NULL,
  buyer_total REAL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  ml_commission REAL NOT NULL,
  shipping_cost REAL NOT NULL,
  ads_cost_allocated REAL NOT NULL DEFAULT 0,
  cost_applied REAL,
  net_profit REAL
);

CREATE TABLE IF NOT EXISTS ads_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

- [ ] **Step 2: Write the failing test for `db/client.ts`**

Create `db/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

const TEST_DB_PATH = "./data/test-client.db";

describe("getDb", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    vi.resetModules();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("creates all expected tables", async () => {
    const { getDb } = await import("./client");
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "products",
        "product_costs",
        "orders",
        "order_items",
        "ads_spend",
        "auth_tokens",
      ])
    );
  });

  it("returns the same connection instance on repeated calls", async () => {
    const { getDb } = await import("./client");
    expect(getDb()).toBe(getDb());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run db/client.test.ts`
Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 4: Implement `db/client.ts`**

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = process.env.DB_PATH || "./data/ml-dashboard.db";
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run db/client.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing test for `db/tokens.ts`**

Create `db/tokens.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

const TEST_DB_PATH = "./data/test-tokens.db";

describe("saveTokens / getTokens", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    vi.resetModules();
  });
  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("returns null when no tokens have been saved", async () => {
    const { getDb } = await import("./client");
    const { getTokens } = await import("./tokens");
    expect(getTokens(getDb())).toBeNull();
  });

  it("saves and retrieves tokens, overwriting on repeated save", async () => {
    const { getDb } = await import("./client");
    const { saveTokens, getTokens } = await import("./tokens");
    const db = getDb();
    saveTokens(db, { accessToken: "a1", refreshToken: "r1", expiresAt: "2026-01-01T00:00:00Z" });
    saveTokens(db, { accessToken: "a2", refreshToken: "r2", expiresAt: "2026-01-02T00:00:00Z" });
    expect(getTokens(db)).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: "2026-01-02T00:00:00Z" });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run db/tokens.test.ts`
Expected: FAIL — `Cannot find module './tokens'`

- [ ] **Step 8: Implement `db/tokens.ts`**

```ts
import type Database from "better-sqlite3";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export function saveTokens(db: Database.Database, tokens: AuthTokens): void {
  db.prepare(
    `INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at`
  ).run(tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
}

export function getTokens(db: Database.Database): AuthTokens | null {
  const row = db
    .prepare("SELECT access_token, refresh_token, expires_at FROM auth_tokens WHERE id = 1")
    .get() as { access_token: string; refresh_token: string; expires_at: string } | undefined;
  if (!row) return null;
  return { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run db/tokens.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add db
git commit -m "feat: add SQLite data layer with versioned costs and token storage"
```

---

### Task 3: Profitability calculations

**Files:**
- Create: `sync/profitability.ts`
- Create: `sync/profitability.test.ts`

**Interfaces:**
- Produces: `getCostAtDate(costs: ProductCostEntry[], date: string): number | null`; `allocateAdsCost(dailySpend: number, unitsSoldThatDay: number, unitsInThisLine: number): number`; `calculateNetProfit(input: NetProfitInput): number | null`; types `ProductCostEntry = { cost: number; validFrom: string }`, `NetProfitInput = { unitPrice: number; quantity: number; mlCommission: number; shippingCost: number; adsCostAllocated: number; costApplied: number | null }`.
- Consumes: nothing (pure functions, no dependencies).

- [ ] **Step 1: Write the failing tests**

Create `sync/profitability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getCostAtDate, allocateAdsCost, calculateNetProfit } from "./profitability";

describe("getCostAtDate", () => {
  it("returns null when no cost entries exist", () => {
    expect(getCostAtDate([], "2026-01-01")).toBeNull();
  });

  it("returns the most recent cost valid on or before the date", () => {
    const costs = [
      { cost: 100, validFrom: "2026-01-01" },
      { cost: 120, validFrom: "2026-03-01" },
    ];
    expect(getCostAtDate(costs, "2026-02-15")).toBe(100);
    expect(getCostAtDate(costs, "2026-03-15")).toBe(120);
  });

  it("returns null when the sale date is before any cost was loaded", () => {
    const costs = [{ cost: 100, validFrom: "2026-03-01" }];
    expect(getCostAtDate(costs, "2026-01-01")).toBeNull();
  });

  it("picks the latest entry when two share the same validFrom date", () => {
    const costs = [
      { cost: 100, validFrom: "2026-01-01" },
      { cost: 150, validFrom: "2026-01-01" },
    ];
    expect(getCostAtDate(costs, "2026-01-01")).toBe(150);
  });
});

describe("allocateAdsCost", () => {
  it("returns 0 when no units were sold that day", () => {
    expect(allocateAdsCost(500, 0, 1)).toBe(0);
  });

  it("prorates spend proportionally to units in this line", () => {
    expect(allocateAdsCost(500, 5, 2)).toBe(200);
  });

  it("returns the full spend when this line is the only unit sold", () => {
    expect(allocateAdsCost(500, 1, 1)).toBe(500);
  });
});

describe("calculateNetProfit", () => {
  it("returns null when no cost was applied", () => {
    const result = calculateNetProfit({
      unitPrice: 1000,
      quantity: 1,
      mlCommission: 130,
      shippingCost: 90,
      adsCostAllocated: 50,
      costApplied: null,
    });
    expect(result).toBeNull();
  });

  it("computes net profit subtracting all costs", () => {
    const result = calculateNetProfit({
      unitPrice: 1000,
      quantity: 2,
      mlCommission: 130,
      shippingCost: 90,
      adsCostAllocated: 50,
      costApplied: 300,
    });
    expect(result).toBe(1130);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run sync/profitability.test.ts`
Expected: FAIL — `Cannot find module './profitability'`

- [ ] **Step 3: Implement `sync/profitability.ts`**

```ts
export interface ProductCostEntry {
  cost: number;
  validFrom: string;
}

export function getCostAtDate(costs: ProductCostEntry[], date: string): number | null {
  const applicable = costs
    .filter((c) => c.validFrom <= date)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return applicable.length > 0 ? applicable[0].cost : null;
}

export function allocateAdsCost(
  dailySpend: number,
  unitsSoldThatDay: number,
  unitsInThisLine: number
): number {
  if (unitsSoldThatDay <= 0) return 0;
  return (dailySpend / unitsSoldThatDay) * unitsInThisLine;
}

export interface NetProfitInput {
  unitPrice: number;
  quantity: number;
  mlCommission: number;
  shippingCost: number;
  adsCostAllocated: number;
  costApplied: number | null;
}

export function calculateNetProfit(input: NetProfitInput): number | null {
  if (input.costApplied === null) return null;
  return (
    input.unitPrice * input.quantity -
    input.mlCommission -
    input.shippingCost -
    input.adsCostAllocated -
    input.costApplied * input.quantity
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run sync/profitability.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add sync/profitability.ts sync/profitability.test.ts
git commit -m "feat: add profitability calculation with versioned cost lookup"
```

---

### Task 4: Mercado Libre API client

**Files:**
- Create: `mcp/ml-client.ts`
- Create: `mcp/ml-client.test.ts`

**Interfaces:**
- Produces: `mlFetch(path: string, accessToken: string, init?: RequestInit): Promise<any>`; `refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>`; `class MlApiError extends Error { status: number }`.
- Consumes: `process.env.ML_CLIENT_ID`, `process.env.ML_CLIENT_SECRET`.

- [ ] **Step 1: Write the failing tests**

Create `mcp/ml-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { mlFetch, refreshAccessToken, MlApiError } from "./ml-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mlFetch", () => {
  it("sends the access token as a Bearer header and returns parsed JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hello: "world" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await mlFetch("/users/me", "token123");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/users/me",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token123" }) })
    );
  });

  it("throws MlApiError when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }));

    await expect(mlFetch("/users/me", "bad-token")).rejects.toBeInstanceOf(MlApiError);
  });

  it("retries once after a 429 response and then returns the successful result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => "0" }, text: async () => "rate limited" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ hello: "world" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await mlFetch("/users/me", "token123");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry and throws MlApiError on a second 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, headers: { get: () => "0" }, text: async () => "rate limited" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(mlFetch("/users/me", "token123")).rejects.toBeInstanceOf(MlApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("refreshAccessToken", () => {
  it("posts the refresh grant and returns the new tokens", async () => {
    process.env.ML_CLIENT_ID = "cid";
    process.env.ML_CLIENT_SECRET = "csecret";
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ access_token: "new-a", refresh_token: "new-r", expires_in: 21600 }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshAccessToken("old-r");

    expect(result).toEqual({ accessToken: "new-a", refreshToken: "new-r", expiresIn: 21600 });
  });

  it("throws MlApiError when the refresh request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "invalid_grant" }));

    await expect(refreshAccessToken("bad-r")).rejects.toBeInstanceOf(MlApiError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run mcp/ml-client.test.ts`
Expected: FAIL — `Cannot find module './ml-client'`

- [ ] **Step 3: Implement `mcp/ml-client.ts`**

```ts
const ML_API_BASE = "https://api.mercadolibre.com";

export class MlApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function mlFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  retryCount = 0
): Promise<any> {
  const res = await fetch(`${ML_API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 429 && retryCount < 1) {
    const retryAfterHeader = (res as any).headers?.get?.("Retry-After");
    const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return mlFetch(path, accessToken, init, retryCount + 1);
  }
  if (!res.ok) {
    throw new MlApiError(res.status, `ML API error ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json();
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(`${ML_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new MlApiError(res.status, `Token refresh failed: ${await res.text()}`);
  }
  const data = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run mcp/ml-client.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp/ml-client.ts mcp/ml-client.test.ts
git commit -m "feat: add Mercado Libre API client with token refresh"
```

---

### Task 5: Token refresh helper + OAuth routes

**Files:**
- Create: `mcp/auth.ts`
- Create: `mcp/auth.test.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/callback/route.ts`
- Create: `app/api/auth/callback/route.test.ts`

**Interfaces:**
- Consumes: `getDb` from `@/db/client`; `getTokens`, `saveTokens`, `AuthTokens` from `@/db/tokens`; `refreshAccessToken` from `./ml-client`.
- Produces: `getValidAccessToken(): Promise<string>` — used by every MCP tool in Task 6.

- [ ] **Step 1: Write the failing tests for `mcp/auth.ts`**

Create `mcp/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/db/tokens", () => ({ getTokens: vi.fn(), saveTokens: vi.fn() }));
vi.mock("./ml-client", () => ({ refreshAccessToken: vi.fn() }));

import { getValidAccessToken } from "./auth";
import { getTokens, saveTokens } from "@/db/tokens";
import { refreshAccessToken } from "./ml-client";

describe("getValidAccessToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when there are no saved tokens", async () => {
    vi.mocked(getTokens).mockReturnValue(null);
    await expect(getValidAccessToken()).rejects.toThrow(/No hay tokens/);
  });

  it("returns the current token when it has not expired", async () => {
    vi.mocked(getTokens).mockReturnValue({
      accessToken: "valid",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const token = await getValidAccessToken();
    expect(token).toBe("valid");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes and saves new tokens when close to expiring", async () => {
    vi.mocked(getTokens).mockReturnValue({
      accessToken: "old",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: "new", refreshToken: "r2", expiresIn: 21600 });
    const token = await getValidAccessToken();
    expect(token).toBe("new");
    expect(saveTokens).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mcp/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`

- [ ] **Step 3: Implement `mcp/auth.ts`**

```ts
import { getDb } from "@/db/client";
import { getTokens, saveTokens } from "@/db/tokens";
import { refreshAccessToken } from "./ml-client";

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export async function getValidAccessToken(): Promise<string> {
  const db = getDb();
  const tokens = getTokens(db);
  if (!tokens) {
    throw new Error("No hay tokens guardados. Autenticate en /api/auth/login primero.");
  }
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Date.now() < expiresAt - EXPIRY_BUFFER_MS) {
    return tokens.accessToken;
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
  saveTokens(db, { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: newExpiresAt });
  return refreshed.accessToken;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run mcp/auth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement `app/api/auth/login/route.ts`**

```ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ML_CLIENT_ID!,
    redirect_uri: process.env.ML_REDIRECT_URI!,
  });
  return NextResponse.redirect(`https://auth.mercadolibre.com.ar/authorization?${params.toString()}`);
}
```

- [ ] **Step 6: Write the failing test for the callback route's validation branch**

Create `app/api/auth/callback/route.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/db/tokens", () => ({ saveTokens: vi.fn() }));

import { GET } from "./route";

describe("GET /api/auth/callback", () => {
  it("returns 400 when the authorization code is missing", async () => {
    const request = { nextUrl: { searchParams: new URLSearchParams() } } as any;
    const res = await GET(request);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing authorization code" });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run app/api/auth/callback/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 8: Implement `app/api/auth/callback/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { saveTokens } from "@/db/tokens";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI!,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Token exchange failed: ${await res.text()}` }, { status: 502 });
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  saveTokens(getDb(), { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt });

  return NextResponse.redirect(new URL("/", request.url));
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run app/api/auth/callback/route.test.ts`
Expected: PASS (1 test)

- [ ] **Step 10: Commit**

```bash
git add mcp/auth.ts mcp/auth.test.ts app/api/auth
git commit -m "feat: add OAuth login/callback flow and token refresh helper"
```

**Manual verification (not automatable — needs your real ML app credentials):**
1. Fill in `.env` with your real `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_SELLER_ID`, and confirm the redirect URI matches exactly what's configured in your Mercado Libre Developers app.
2. Run `npm run dev`, visit `http://localhost:3000/api/auth/login`, complete the consent screen.
3. Confirm you're redirected back to `http://localhost:3000/` (the callback ran without error) and that `data/ml-dashboard.db` now has a row in `auth_tokens`.

---

### Task 6: MCP tools

**Files:**
- Create: `mcp/tools.ts`
- Create: `mcp/tools.test.ts`

**Interfaces:**
- Consumes: `mlFetch` from `./ml-client`; `getValidAccessToken` from `./auth`.
- Produces: `listProducts(sellerId): Promise<MlProduct[]>`; `listOrders(sellerId, sinceIso): Promise<string[]>`; `getOrderDetail(orderId): Promise<MlOrder>`; `getAdsSpend(sellerId, dateFrom, dateTo): Promise<{productId, date, amount}[]>`; types `MlProduct = { id, title, sku, price, stock, permalink }`, `MlOrderItem = { productId, unitPrice, quantity, mlCommission, shippingCost }`, `MlOrder = { id, dateCreated, status, buyerTotal, items: MlOrderItem[] }`.

- [ ] **Step 1: Write the failing tests**

Create `mcp/tools.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ml-client", () => ({ mlFetch: vi.fn() }));
vi.mock("./auth", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("token") }));

import { listProducts, getOrderDetail, listOrders } from "./tools";
import { mlFetch } from "./ml-client";

describe("listProducts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array when the seller has no active items", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ results: [] });
    expect(await listProducts("123")).toEqual([]);
  });

  it("fetches details for each item id found in the search", async () => {
    vi.mocked(mlFetch)
      .mockResolvedValueOnce({ results: ["MLA1", "MLA2"] })
      .mockResolvedValueOnce([
        { body: { id: "MLA1", title: "Producto 1", seller_custom_field: "SKU1", price: 1000, available_quantity: 5, permalink: "url1" } },
        { body: { id: "MLA2", title: "Producto 2", seller_custom_field: null, price: 2000, available_quantity: 3, permalink: "url2" } },
      ]);
    const products = await listProducts("123");
    expect(products).toHaveLength(2);
    expect(products[0]).toEqual({ id: "MLA1", title: "Producto 1", sku: "SKU1", price: 1000, stock: 5, permalink: "url1" });
  });
});

describe("getOrderDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps order items with the shared shipping cost per line", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({
      id: 999,
      date_created: "2026-01-01T00:00:00Z",
      status: "paid",
      total_amount: 1000,
      shipping: { cost: 90 },
      order_items: [{ item: { id: "MLA1" }, unit_price: 500, quantity: 2, sale_fee: 65 }],
    });
    const order = await getOrderDetail("999");
    expect(order.items).toEqual([{ productId: "MLA1", unitPrice: 500, quantity: 2, mlCommission: 65, shippingCost: 90 }]);
  });

  it("defaults shipping cost to 0 when the order has no shipping info", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({
      id: 1000,
      date_created: "2026-01-01T00:00:00Z",
      status: "paid",
      total_amount: 500,
      order_items: [{ item: { id: "MLA1" }, unit_price: 500, quantity: 1, sale_fee: 65 }],
    });
    const order = await getOrderDetail("1000");
    expect(order.items[0].shippingCost).toBe(0);
  });
});

describe("listOrders", () => {
  it("returns order ids from the search results", async () => {
    vi.mocked(mlFetch).mockResolvedValueOnce({ results: [{ id: 1 }, { id: 2 }] });
    expect(await listOrders("123", "2026-01-01T00:00:00Z")).toEqual(["1", "2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run mcp/tools.test.ts`
Expected: FAIL — `Cannot find module './tools'`

- [ ] **Step 3: Implement `mcp/tools.ts`**

```ts
import { mlFetch } from "./ml-client";
import { getValidAccessToken } from "./auth";

export interface MlProduct {
  id: string;
  title: string;
  sku: string | null;
  price: number;
  stock: number;
  permalink: string;
}

export async function listProducts(sellerId: string): Promise<MlProduct[]> {
  const token = await getValidAccessToken();
  const search = await mlFetch(`/users/${sellerId}/items/search?status=active`, token);
  const ids: string[] = search.results;
  if (ids.length === 0) return [];
  const details = await mlFetch(`/items?ids=${ids.join(",")}`, token);
  return details.map((entry: any) => ({
    id: entry.body.id,
    title: entry.body.title,
    sku: entry.body.seller_custom_field ?? null,
    price: entry.body.price,
    stock: entry.body.available_quantity,
    permalink: entry.body.permalink,
  }));
}

export interface MlOrderItem {
  productId: string;
  unitPrice: number;
  quantity: number;
  mlCommission: number;
  shippingCost: number;
}

export interface MlOrder {
  id: string;
  dateCreated: string;
  status: string;
  buyerTotal: number;
  items: MlOrderItem[];
}

export async function getOrderDetail(orderId: string): Promise<MlOrder> {
  const token = await getValidAccessToken();
  const order = await mlFetch(`/orders/${orderId}`, token);
  const shippingCost = order.shipping?.cost ?? 0;
  return {
    id: String(order.id),
    dateCreated: order.date_created,
    status: order.status,
    buyerTotal: order.total_amount,
    items: order.order_items.map((oi: any) => ({
      productId: oi.item.id,
      unitPrice: oi.unit_price,
      quantity: oi.quantity,
      mlCommission: oi.sale_fee ?? 0,
      shippingCost,
    })),
  };
}

export async function listOrders(sellerId: string, sinceIso: string): Promise<string[]> {
  const token = await getValidAccessToken();
  const search = await mlFetch(`/orders/search?seller=${sellerId}&order.date_created.from=${sinceIso}`, token);
  return search.results.map((o: any) => String(o.id));
}

export async function getAdsSpend(
  sellerId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ productId: string; date: string; amount: number }[]> {
  const token = await getValidAccessToken();
  const campaigns = await mlFetch(
    `/advertising/product_ads/campaigns?date_from=${dateFrom}&date_to=${dateTo}`,
    token
  );
  const rows: { productId: string; date: string; amount: number }[] = [];
  for (const c of campaigns.results ?? []) {
    for (const metric of c.metrics_by_day ?? []) {
      rows.push({ productId: metric.item_id, date: metric.date, amount: metric.cost });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run mcp/tools.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp/tools.ts mcp/tools.test.ts
git commit -m "feat: add MCP tool functions wrapping the ML API"
```

**Known risk to validate against the real account (per spec):** `getAdsSpend`'s field mapping (`/advertising/product_ads/campaigns`, `metrics_by_day`, `item_id`, `cost`) is based on Mercado Ads' documented shape but hasn't been checked against this account's real response yet, and Ads API access sometimes needs a separate approved scope. After Task 5's manual OAuth verification, call this endpoint once with a real token (e.g. via `curl` with the stored access token) and adjust the field names in `getAdsSpend` if the real response differs. If the account doesn't have Ads API access, leave `getAdsSpend` returning `[]` — the rest of the app keeps working, just without ads cost in the profitability calc, which is exactly the fallback the spec calls for.

---

### Task 7: MCP server registration

**Files:**
- Create: `mcp/server.ts`
- Create: `mcp/server.test.ts`

**Interfaces:**
- Consumes: `listProducts`, `listOrders`, `getOrderDetail`, `getAdsSpend` from `./tools`.
- Produces: `createMcpServer(): McpServer` with tools `list_products`, `list_orders`, `get_order_detail`, `get_ads_spend` registered.

- [ ] **Step 1: Write the failing test**

Create `mcp/server.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("./tools", () => ({
  listProducts: vi.fn().mockResolvedValue([{ id: "MLA1", title: "Producto 1" }]),
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  getAdsSpend: vi.fn(),
}));

import { createMcpServer } from "./server";

describe("createMcpServer", () => {
  it("exposes list_products as a callable MCP tool", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "list_products", arguments: { sellerId: "123" } });
    const text = (result.content as any[])[0].text;
    expect(JSON.parse(text)).toEqual([{ id: "MLA1", title: "Producto 1" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mcp/server.test.ts`
Expected: FAIL — `Cannot find module './server'`

- [ ] **Step 3: Implement `mcp/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listProducts, listOrders, getOrderDetail, getAdsSpend } from "./tools";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "ml-dashboard-mcp", version: "1.0.0" });

  server.tool("list_products", { sellerId: z.string() }, async ({ sellerId }) => ({
    content: [{ type: "text", text: JSON.stringify(await listProducts(sellerId)) }],
  }));

  server.tool(
    "list_orders",
    { sellerId: z.string(), sinceIso: z.string() },
    async ({ sellerId, sinceIso }) => ({
      content: [{ type: "text", text: JSON.stringify(await listOrders(sellerId, sinceIso)) }],
    })
  );

  server.tool("get_order_detail", { orderId: z.string() }, async ({ orderId }) => ({
    content: [{ type: "text", text: JSON.stringify(await getOrderDetail(orderId)) }],
  }));

  server.tool(
    "get_ads_spend",
    { sellerId: z.string(), dateFrom: z.string(), dateTo: z.string() },
    async ({ sellerId, dateFrom, dateTo }) => ({
      content: [{ type: "text", text: JSON.stringify(await getAdsSpend(sellerId, dateFrom, dateTo)) }],
    })
  );

  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run mcp/server.test.ts`
Expected: PASS (1 test) — this proves the ML integration is genuinely wired as MCP end-to-end.

- [ ] **Step 5: Commit**

```bash
git add mcp/server.ts mcp/server.test.ts
git commit -m "feat: register ML tools on an MCP server"
```

**Deliberately out of scope for v1:** exposing this server over HTTP (e.g. for Claude Desktop to connect to). The in-memory test above proves the MCP wiring works; `sync-service.ts` (Task 8) calls the tool functions directly in-process. Adding an HTTP transport is a clean follow-up later, not needed for the dashboard to work.

---

### Task 8: Sync service

**Files:**
- Create: `sync/sync-service.ts`
- Create: `sync/sync-service.test.ts`

**Interfaces:**
- Consumes: `listProducts`, `listOrders`, `getOrderDetail`, `getAdsSpend` from `@/mcp/tools`; `getCostAtDate`, `allocateAdsCost`, `calculateNetProfit` from `./profitability`; a `better-sqlite3` `Database.Database` instance.
- Produces: `runSync(db, sellerId: string, sinceIso: string): Promise<SyncResult>` where `SyncResult = { productsSynced: number; ordersSynced: number; adsRowsSynced: number }`.

- [ ] **Step 1: Write the failing tests**

Create `sync/sync-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

vi.mock("@/mcp/tools", () => ({
  listProducts: vi.fn(),
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  getAdsSpend: vi.fn(),
}));

const TEST_DB_PATH = "./data/test-sync.db";

describe("runSync", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    vi.resetModules();
    vi.clearAllMocks();
  });
  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("persists products, orders and a computed net_profit per order item", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValue([
      { id: "MLA1", title: "Producto 1", sku: "SKU1", price: 1000, stock: 5, permalink: "url" },
    ]);
    vi.mocked(listOrders).mockResolvedValue(["ORD1"]);
    vi.mocked(getOrderDetail).mockResolvedValue({
      id: "ORD1",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 1000,
      items: [{ productId: "MLA1", unitPrice: 1000, quantity: 1, mlCommission: 130, shippingCost: 90 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValue([{ productId: "MLA1", date: "2026-01-10", amount: 50 }]);

    const { getDb } = await import("@/db/client");
    const db = getDb();
    db.prepare(`INSERT INTO product_costs (product_id, cost, valid_from) VALUES (?, ?, ?)`).run("MLA1", 300, "2026-01-01");

    const { runSync } = await import("./sync-service");
    const result = await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");

    expect(result).toEqual({ productsSynced: 1, ordersSynced: 1, adsRowsSynced: 1 });

    const item = db.prepare(`SELECT * FROM order_items WHERE order_id = 'ORD1'`).get() as any;
    expect(item.net_profit).toBe(430); // 1000 - 130 - 90 - 50 - 300
    expect(item.cost_applied).toBe(300);
  });

  it("leaves net_profit null when the product has no cost loaded", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValue([]);
    vi.mocked(listOrders).mockResolvedValue(["ORD2"]);
    vi.mocked(getOrderDetail).mockResolvedValue({
      id: "ORD2",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 500,
      items: [{ productId: "MLA2", unitPrice: 500, quantity: 1, mlCommission: 65, shippingCost: 90 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValue([]);

    const { getDb } = await import("@/db/client");
    const db = getDb();
    const { runSync } = await import("./sync-service");
    await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");

    const item = db.prepare(`SELECT * FROM order_items WHERE order_id = 'ORD2'`).get() as any;
    expect(item.net_profit).toBeNull();
    expect(item.cost_applied).toBeNull();
  });

  it("re-running sync for the same order does not duplicate order_items", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValue([]);
    vi.mocked(listOrders).mockResolvedValue(["ORD3"]);
    vi.mocked(getOrderDetail).mockResolvedValue({
      id: "ORD3",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 500,
      items: [{ productId: "MLA3", unitPrice: 500, quantity: 1, mlCommission: 65, shippingCost: 90 }],
    });
    vi.mocked(getAdsSpend).mockResolvedValue([]);

    const { getDb } = await import("@/db/client");
    const db = getDb();
    const { runSync } = await import("./sync-service");
    await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");
    await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");

    const count = db.prepare(`SELECT COUNT(*) as c FROM order_items WHERE order_id = 'ORD3'`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("keeps products and orders synced even when getAdsSpend fails", async () => {
    const { listProducts, listOrders, getOrderDetail, getAdsSpend } = await import("@/mcp/tools");
    vi.mocked(listProducts).mockResolvedValue([
      { id: "MLA4", title: "Producto 4", sku: null, price: 100, stock: 1, permalink: "url" },
    ]);
    vi.mocked(listOrders).mockResolvedValue(["ORD4"]);
    vi.mocked(getOrderDetail).mockResolvedValue({
      id: "ORD4",
      dateCreated: "2026-01-10T12:00:00Z",
      status: "paid",
      buyerTotal: 100,
      items: [{ productId: "MLA4", unitPrice: 100, quantity: 1, mlCommission: 13, shippingCost: 20 }],
    });
    vi.mocked(getAdsSpend).mockRejectedValue(new Error("Ads API no disponible"));

    const { getDb } = await import("@/db/client");
    const db = getDb();
    const { runSync } = await import("./sync-service");

    const result = await runSync(db, "SELLER1", "2026-01-01T00:00:00Z");

    expect(result.productsSynced).toBe(1);
    expect(result.ordersSynced).toBe(1);
    expect(result.adsRowsSynced).toBe(0);
    const order = db.prepare(`SELECT * FROM orders WHERE id = 'ORD4'`).get();
    expect(order).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run sync/sync-service.test.ts`
Expected: FAIL — `Cannot find module './sync-service'`

- [ ] **Step 3: Implement `sync/sync-service.ts`**

```ts
import type Database from "better-sqlite3";
import { listProducts, listOrders, getOrderDetail, getAdsSpend } from "@/mcp/tools";
import { getCostAtDate, allocateAdsCost, calculateNetProfit } from "./profitability";

export interface SyncResult {
  productsSynced: number;
  ordersSynced: number;
  adsRowsSynced: number;
}

export async function runSync(db: Database.Database, sellerId: string, sinceIso: string): Promise<SyncResult> {
  const now = new Date().toISOString();

  const products = await listProducts(sellerId);
  const upsertProduct = db.prepare(
    `INSERT INTO products (id, title, sku, current_price, stock, permalink, updated_at)
     VALUES (@id, @title, @sku, @price, @stock, @permalink, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, sku = excluded.sku, current_price = excluded.current_price,
       stock = excluded.stock, permalink = excluded.permalink, updated_at = excluded.updated_at`
  );
  for (const p of products) {
    upsertProduct.run({ ...p, updated_at: now });
  }

  const orderIds = await listOrders(sellerId, sinceIso);
  const upsertOrder = db.prepare(
    `INSERT INTO orders (id, date_created, status, buyer_total) VALUES (@id, @date_created, @status, @buyer_total)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, buyer_total = excluded.buyer_total`
  );
  const deleteItemsForOrder = db.prepare(`DELETE FROM order_items WHERE order_id = ?`);
  const insertItem = db.prepare(
    `INSERT INTO order_items
      (order_id, product_id, unit_price, quantity, ml_commission, shipping_cost, ads_cost_allocated, cost_applied, net_profit)
     VALUES (@order_id, @product_id, @unit_price, @quantity, @ml_commission, @shipping_cost, @ads_cost_allocated, @cost_applied, @net_profit)`
  );
  const getCosts = db.prepare(`SELECT cost, valid_from as validFrom FROM product_costs WHERE product_id = ?`);

  let ordersSynced = 0;
  for (const orderId of orderIds) {
    const order = await getOrderDetail(orderId);
    upsertOrder.run({ id: order.id, date_created: order.dateCreated, status: order.status, buyer_total: order.buyerTotal });
    deleteItemsForOrder.run(order.id);

    for (const item of order.items) {
      const costs = getCosts.all(item.productId) as { cost: number; validFrom: string }[];
      const costApplied = getCostAtDate(costs, order.dateCreated);
      const netProfit = calculateNetProfit({
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        mlCommission: item.mlCommission,
        shippingCost: item.shippingCost,
        adsCostAllocated: 0,
        costApplied,
      });
      insertItem.run({
        order_id: order.id,
        product_id: item.productId,
        unit_price: item.unitPrice,
        quantity: item.quantity,
        ml_commission: item.mlCommission,
        shipping_cost: item.shippingCost,
        ads_cost_allocated: 0,
        cost_applied: costApplied,
        net_profit: netProfit,
      });
    }
    ordersSynced += 1;
  }

  let adsRowsSynced = 0;
  try {
    const dateTo = now.slice(0, 10);
    const adsRows = await getAdsSpend(sellerId, sinceIso.slice(0, 10), dateTo);
    const deleteAdsForRange = db.prepare(`DELETE FROM ads_spend WHERE date >= ? AND date <= ?`);
    deleteAdsForRange.run(sinceIso.slice(0, 10), dateTo);
    const upsertAds = db.prepare(`INSERT INTO ads_spend (product_id, date, amount) VALUES (?, ?, ?)`);
    for (const row of adsRows) {
      upsertAds.run(row.productId, row.date, row.amount);
    }
    adsRowsSynced = adsRows.length;
  } catch (err) {
    // La sincronización de productos y órdenes ya se guardó arriba; si falla
    // Mercado Ads (ej. sin acceso a la API) el resto del dashboard sigue
    // funcionando, solo sin dato de publicidad hasta el próximo sync exitoso.
    console.error("No se pudo sincronizar publicidad, se continúa sin ese dato:", (err as Error).message);
  }

  reallocateAdsCosts(db);

  return { productsSynced: products.length, ordersSynced, adsRowsSynced };
}

function reallocateAdsCosts(db: Database.Database): void {
  const items = db
    .prepare(
      `SELECT oi.id, oi.product_id as productId, oi.quantity, o.date_created as dateCreated,
              oi.unit_price as unitPrice, oi.ml_commission as mlCommission,
              oi.shipping_cost as shippingCost, oi.cost_applied as costApplied
       FROM order_items oi JOIN orders o ON o.id = oi.order_id`
    )
    .all() as any[];

  const unitsSoldByProductDate = new Map<string, number>();
  for (const it of items) {
    const key = `${it.productId}|${it.dateCreated.slice(0, 10)}`;
    unitsSoldByProductDate.set(key, (unitsSoldByProductDate.get(key) ?? 0) + it.quantity);
  }

  const adsByProductDate = new Map<string, number>();
  for (const row of db.prepare(`SELECT product_id as productId, date, amount FROM ads_spend`).all() as any[]) {
    adsByProductDate.set(`${row.productId}|${row.date}`, row.amount);
  }

  const updateItem = db.prepare(`UPDATE order_items SET ads_cost_allocated = ?, net_profit = ? WHERE id = ?`);

  for (const it of items) {
    const key = `${it.productId}|${it.dateCreated.slice(0, 10)}`;
    const dailySpend = adsByProductDate.get(key) ?? 0;
    const unitsSoldThatDay = unitsSoldByProductDate.get(key) ?? 0;
    const adsCostAllocated = allocateAdsCost(dailySpend, unitsSoldThatDay, it.quantity);
    const netProfit = calculateNetProfit({
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      mlCommission: it.mlCommission,
      shippingCost: it.shippingCost,
      adsCostAllocated,
      costApplied: it.costApplied,
    });
    updateItem.run(adsCostAllocated, netProfit, it.id);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run sync/sync-service.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add sync/sync-service.ts sync/sync-service.test.ts
git commit -m "feat: add sync orchestration persisting computed net profit"
```

---

### Task 9: Dashboard API routes

**Files:**
- Create: `app/api/sync/route.ts`
- Create: `app/api/sync/route.test.ts`
- Create: `app/api/products/route.ts`
- Create: `app/api/products/route.test.ts`
- Create: `app/api/orders/route.ts`
- Create: `app/api/summary/route.ts`

**Interfaces:**
- Consumes: `getDb` from `@/db/client`; `runSync` from `@/sync/sync-service`.
- Produces: `POST /api/sync`, `GET/PATCH /api/products`, `GET /api/orders?from&to&productId`, `GET /api/summary?from&to` — all consumed by the UI in Tasks 10-13.

- [ ] **Step 1: Write the failing tests for `/api/sync`**

Create `app/api/sync/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/sync/sync-service", () => ({ runSync: vi.fn() }));

import { POST } from "./route";
import { getDb } from "@/db/client";
import { runSync } from "@/sync/sync-service";

describe("POST /api/sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the sync result as JSON", async () => {
    vi.mocked(getDb).mockReturnValue({ prepare: () => ({ get: () => ({ latest: "2026-01-01T00:00:00Z" }) }) } as any);
    vi.mocked(runSync).mockResolvedValue({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0 });

    const res = await POST();

    expect(await res.json()).toEqual({ productsSynced: 1, ordersSynced: 2, adsRowsSynced: 0 });
  });

  it("returns a 500 with the error message when sync fails", async () => {
    vi.mocked(getDb).mockReturnValue({ prepare: () => ({ get: () => ({ latest: null }) }) } as any);
    vi.mocked(runSync).mockRejectedValue(new Error("boom"));

    const res = await POST();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implement `app/api/sync/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { runSync } from "@/sync/sync-service";

export const runtime = "nodejs";

export async function POST() {
  const db = getDb();
  const sinceRow = db.prepare(`SELECT MAX(date_created) as latest FROM orders`).get() as { latest: string | null };
  const sinceIso = sinceRow.latest ?? "2020-01-01T00:00:00Z";
  try {
    const result = await runSync(db, process.env.ML_SELLER_ID!, sinceIso);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for `/api/products` PATCH validation**

Create `app/api/products/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

import { PATCH } from "./route";
import { getDb } from "@/db/client";

describe("PATCH /api/products", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when cost is missing or negative", async () => {
    const request = { json: async () => ({ productId: "MLA1", cost: -5 }) } as any;
    const res = await PATCH(request);
    expect(res.status).toBe(400);
  });

  it("inserts a new versioned cost row and returns ok", async () => {
    const run = vi.fn();
    vi.mocked(getDb).mockReturnValue({ prepare: () => ({ run }) } as any);
    const request = { json: async () => ({ productId: "MLA1", cost: 350 }) } as any;

    const res = await PATCH(request);

    expect(await res.json()).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith("MLA1", 350, expect.any(String));
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run app/api/products/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 7: Implement `app/api/products/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.sku, p.current_price as currentPrice, p.stock,
              (SELECT cost FROM product_costs pc WHERE pc.product_id = p.id ORDER BY pc.valid_from DESC LIMIT 1) as currentCost
       FROM products p ORDER BY p.title`
    )
    .all();
  return NextResponse.json(rows);
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { productId, cost } = body as { productId: string; cost: number };
  if (!productId || typeof cost !== "number" || cost < 0) {
    return NextResponse.json({ error: "productId y cost (>= 0) son requeridos" }, { status: 400 });
  }
  const db = getDb();
  db.prepare(`INSERT INTO product_costs (product_id, cost, valid_from) VALUES (?, ?, ?)`).run(
    productId,
    cost,
    new Date().toISOString()
  );
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run app/api/products/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Implement `app/api/orders/route.ts`** (happy-path only, per spec's testing scope — no dedicated test file)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const productId = searchParams.get("productId");

  const db = getDb();
  const query = `
    SELECT oi.id, o.id as orderId, o.date_created as dateCreated, oi.product_id as productId,
           p.title as productTitle, oi.unit_price as unitPrice, oi.quantity,
           oi.ml_commission as mlCommission, oi.shipping_cost as shippingCost,
           oi.ads_cost_allocated as adsCostAllocated, oi.cost_applied as costApplied,
           oi.net_profit as netProfit
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.date_created BETWEEN ? AND ?
      ${productId ? "AND oi.product_id = ?" : ""}
    ORDER BY o.date_created DESC
  `;
  const params = productId ? [from, to, productId] : [from, to];
  const rows = db.prepare(query).all(...params);
  return NextResponse.json(rows);
}
```

- [ ] **Step 10: Implement `app/api/summary/route.ts`** (happy-path only, per spec's testing scope)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";

  const db = getDb();
  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(oi.unit_price * oi.quantity), 0) as grossSales,
         COALESCE(SUM(oi.ml_commission), 0) as totalCommission,
         COALESCE(SUM(oi.shipping_cost), 0) as totalShipping,
         COALESCE(SUM(oi.ads_cost_allocated), 0) as totalAds,
         COALESCE(SUM(oi.cost_applied * oi.quantity), 0) as totalCost,
         COALESCE(SUM(oi.net_profit), 0) as netProfit,
         SUM(CASE WHEN oi.cost_applied IS NULL THEN 1 ELSE 0 END) as itemsMissingCost
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.date_created BETWEEN ? AND ?`
    )
    .get(from, to);
  return NextResponse.json(totals);
}
```

- [ ] **Step 11: Commit**

```bash
git add app/api/sync app/api/products app/api/orders app/api/summary
git commit -m "feat: add dashboard API routes for sync, products, orders and summary"
```

---

### Task 10: UI shell + Resumen page

**Files:**
- Modify: `app/page.tsx`
- Create: `app/SyncButton.tsx`

**Interfaces:**
- Consumes: `GET /api/summary?from&to`, `POST /api/sync` (Task 9).

- [ ] **Step 1: Create `app/SyncButton.tsx`**

```tsx
"use client";

import { useState } from "react";

export function SyncButton() {
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSync() {
    setStatus("syncing");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");
      setMessage(`Productos: ${data.productsSynced} · Órdenes: ${data.ordersSynced} · Ads: ${data.adsRowsSynced}`);
      setStatus("done");
    } catch (err) {
      setMessage((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={handleSync} disabled={status === "syncing"}>
        {status === "syncing" ? "Sincronizando..." : "Sincronizar"}
      </button>
      {message && <span style={{ marginLeft: 12, color: status === "error" ? "#b00020" : "#333" }}>{message}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Replace `app/page.tsx` with the Resumen page**

```tsx
"use client";

import { useEffect, useState } from "react";
import { SyncButton } from "./SyncButton";

interface Summary {
  grossSales: number;
  totalCommission: number;
  totalShipping: number;
  totalAds: number;
  totalCost: number;
  netProfit: number;
  itemsMissingCost: number;
}

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/summary")
      .then((r) => r.json())
      .then(setSummary);
  }, []);

  return (
    <div>
      <h1>Resumen de cuenta</h1>
      <SyncButton />
      {!summary ? (
        <p>Cargando...</p>
      ) : (
        <div className="kpi-grid">
          <div className="kpi-card"><div>Ventas brutas</div><div className="value">{fmt(summary.grossSales)}</div></div>
          <div className="kpi-card"><div>Comisión ML</div><div className="value">{fmt(summary.totalCommission)}</div></div>
          <div className="kpi-card"><div>Envío</div><div className="value">{fmt(summary.totalShipping)}</div></div>
          <div className="kpi-card"><div>Publicidad</div><div className="value">{fmt(summary.totalAds)}</div></div>
          <div className="kpi-card"><div>Costo productos</div><div className="value">{fmt(summary.totalCost)}</div></div>
          <div className="kpi-card"><div>Rentabilidad neta</div><div className="value">{fmt(summary.netProfit)}</div></div>
          {summary.itemsMissingCost > 0 && (
            <div className="kpi-card missing-cost">
              {summary.itemsMissingCost} línea(s) de venta sin costo cargado, excluidas del cálculo
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `http://localhost:3000/`.
Expected: page renders KPI cards (all zero on an empty database), "Sincronizar" button is clickable.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/SyncButton.tsx
git commit -m "feat: add Resumen page with KPIs and manual sync"
```

---

### Task 11: Productos page

**Files:**
- Create: `app/productos/page.tsx`

**Interfaces:**
- Consumes: `GET /api/products`, `PATCH /api/products` (Task 9).

- [ ] **Step 1: Create `app/productos/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

interface Product {
  id: string;
  title: string;
  sku: string | null;
  currentPrice: number;
  stock: number;
  currentCost: number | null;
}

export default function ProductosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});

  function load() {
    fetch("/api/products")
      .then((r) => r.json())
      .then(setProducts);
  }

  useEffect(load, []);

  async function saveCost(productId: string) {
    const cost = Number(editing[productId]);
    if (Number.isNaN(cost) || cost < 0) return;
    await fetch("/api/products", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, cost }),
    });
    setEditing((prev) => ({ ...prev, [productId]: "" }));
    load();
  }

  return (
    <div>
      <h1>Productos</h1>
      <table>
        <thead>
          <tr>
            <th>Título</th>
            <th>SKU</th>
            <th>Precio</th>
            <th>Stock</th>
            <th>Costo vigente</th>
            <th>Nuevo costo</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.title}</td>
              <td>{p.sku ?? "-"}</td>
              <td>{p.currentPrice}</td>
              <td>{p.stock}</td>
              <td className={p.currentCost === null ? "missing-cost" : undefined}>
                {p.currentCost === null ? "Sin costo cargado" : p.currentCost}
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={editing[p.id] ?? ""}
                  onChange={(e) => setEditing((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  style={{ width: 80 }}
                />
                <button onClick={() => saveCost(p.id)}>Guardar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`, open `http://localhost:3000/productos`.
Expected: table renders (empty until you sync); entering a number and clicking "Guardar" on a real product row inserts a new `product_costs` row and the "Costo vigente" column updates.

- [ ] **Step 3: Commit**

```bash
git add app/productos
git commit -m "feat: add Productos page with inline cost editing"
```

---

### Task 12: Ventas page

**Files:**
- Create: `app/ventas/page.tsx`

**Interfaces:**
- Consumes: `GET /api/orders?from&to&productId` (Task 9).

- [ ] **Step 1: Create `app/ventas/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

interface OrderItem {
  id: number;
  orderId: string;
  dateCreated: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  mlCommission: number;
  shippingCost: number;
  adsCostAllocated: number;
  costApplied: number | null;
  netProfit: number | null;
}

export default function VentasPage() {
  const [items, setItems] = useState<OrderItem[]>([]);

  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then(setItems);
  }, []);

  return (
    <div>
      <h1>Ventas</h1>
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Precio</th>
            <th>Cant.</th>
            <th>Comisión</th>
            <th>Envío</th>
            <th>Publicidad</th>
            <th>Costo</th>
            <th>Ganancia neta</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>{new Date(it.dateCreated).toLocaleDateString("es-AR")}</td>
              <td>{it.productTitle}</td>
              <td>{it.unitPrice}</td>
              <td>{it.quantity}</td>
              <td>{it.mlCommission}</td>
              <td>{it.shippingCost}</td>
              <td>{it.adsCostAllocated.toFixed(2)}</td>
              <td className={it.costApplied === null ? "missing-cost" : undefined}>
                {it.costApplied ?? "Sin costo"}
              </td>
              <td>{it.netProfit === null ? "-" : it.netProfit.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`, open `http://localhost:3000/ventas` after syncing at least one real order.
Expected: one row per order line with the full breakdown; rows for products without a loaded cost show "Sin costo" and a dash for ganancia neta.

- [ ] **Step 3: Commit**

```bash
git add app/ventas
git commit -m "feat: add Ventas page with per-order-line breakdown"
```

---

### Task 13: Tendencias page

**Files:**
- Modify: `app/api/summary/route.ts`
- Create: `app/tendencias/page.tsx`

**Interfaces:**
- Produces: `GET /api/summary?groupBy=month` returns `{ month: string; netProfit: number }[]` instead of the aggregate totals shape, when `groupBy=month` is present.
- Consumes: `recharts` `LineChart`.

- [ ] **Step 1: Extend `app/api/summary/route.ts` to support monthly grouping**

Add this branch at the top of the existing `GET` handler, before the aggregate-totals query:

```ts
  const groupBy = searchParams.get("groupBy");
  if (groupBy === "month") {
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%m', o.date_created) as month, COALESCE(SUM(oi.net_profit), 0) as netProfit
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.date_created BETWEEN ? AND ?
         GROUP BY month ORDER BY month`
      )
      .all(from, to);
    return NextResponse.json(rows);
  }
```

(Insert it right after `const db = getDb();` and before the existing `totals` query — the rest of the file is unchanged.)

- [ ] **Step 2: Create `app/tendencias/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

interface MonthlyPoint {
  month: string;
  netProfit: number;
}

export default function TendenciasPage() {
  const [data, setData] = useState<MonthlyPoint[]>([]);

  useEffect(() => {
    fetch("/api/summary?groupBy=month")
      .then((r) => r.json())
      .then(setData);
  }, []);

  return (
    <div>
      <h1>Tendencias</h1>
      <div style={{ width: "100%", height: 320, background: "#fff", borderRadius: 8, padding: 16 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="netProfit" stroke="#4a7" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open `http://localhost:3000/tendencias` after syncing data spanning more than one month.
Expected: line chart renders one point per month with net profit.

- [ ] **Step 4: Commit**

```bash
git add app/api/summary/route.ts app/tendencias
git commit -m "feat: add Tendencias page with monthly net profit trend"
```

---

### Task 14: README and setup docs

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Dashboard de Rentabilidad ML

App local (Next.js) que sincroniza productos, órdenes y publicidad desde Mercado
Libre a través de un servidor MCP embebido, y calcula la rentabilidad real de la
cuenta usando el costo final que vos cargás por producto.

## Setup

1. `npm install`
2. Copiá `.env.example` a `.env` y completá:
   - `ML_CLIENT_ID` / `ML_CLIENT_SECRET`: de tu app en developers.mercadolibre.com
   - `ML_REDIRECT_URI`: debe coincidir exactamente con el configurado en la app de ML (por defecto `http://localhost:3000/api/auth/callback`)
   - `ML_SELLER_ID`: tu user id de Mercado Libre
3. `npm run dev`
4. Andá a `http://localhost:3000/api/auth/login` y autorizá la app.
5. Volvé a `http://localhost:3000/`, entrá a "Productos" y cargá el costo de cada uno.
6. Apretá "Sincronizar" en la pantalla de Resumen.

## Tests

`npm test`

## Notas

- Los tokens y la base SQLite (`data/ml-dashboard.db`) son locales, nunca se commitean.
- Si `getAdsSpend` (en `mcp/tools.ts`) no coincide con la respuesta real de la API de
  Mercado Ads en tu cuenta, ajustá el mapeo de campos ahí — es el único punto marcado
  como "a validar" en el plan de implementación.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add setup instructions"
```
