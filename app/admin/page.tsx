"use client";

import { useEffect, useState } from "react";

interface AccountRow {
  id: string;
  name: string;
  ownerEmail: string;
  mlSellerId: string | null;
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [form, setForm] = useState({ name: "", ownerEmail: "" });
  const [error, setError] = useState("");

  function load() {
    fetch("/api/admin/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts ?? []));
  }

  useEffect(load, []);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name || !form.ownerEmail) return;
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Error al crear la cuenta");
      return;
    }
    setForm({ name: "", ownerEmail: "" });
    load();
  }

  return (
    <div>
      <h1>Cuentas</h1>

      <h2 className="section-title">Nueva cuenta</h2>
      <form className="ad-form" onSubmit={createAccount} style={{ marginBottom: 24 }}>
        <label>
          Nombre
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <label>
          Email del cliente (Google)
          <input
            type="email"
            value={form.ownerEmail}
            onChange={(e) => setForm((p) => ({ ...p, ownerEmail: e.target.value }))}
          />
        </label>
        <button type="submit">Crear</button>
      </form>
      {error && <p className="missing-cost">{error}</p>}

      <h2 className="section-title">Todas las cuentas</h2>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Mercado Libre</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{a.ownerEmail}</td>
              <td>{a.mlSellerId ? `Conectado (seller ${a.mlSellerId})` : "Sin conectar"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
