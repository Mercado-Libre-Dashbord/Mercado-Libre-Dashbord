"use client";

import { useEffect, useState } from "react";

interface AccountRow {
  id: string;
  name: string;
  ownerEmail: string;
  mlSellerId: string | null;
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [form, setForm] = useState({ name: "", ownerEmail: "" });
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  function load() {
    fetch("/api/admin/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts ?? []));
  }

  useEffect(load, []);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.ownerEmail.trim()) {
      setError("Completá nombre y email para crear la cuenta.");
      return;
    }
    setCreating(true);
    try {
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
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Cuentas</h1>

      <h2 className="section-title">Nueva cuenta</h2>
      <form className="ad-form" onSubmit={createAccount} noValidate style={{ marginBottom: 24 }}>
        <div className="field-group">
          <label htmlFor="acc-name">Nombre</label>
          <input
            id="acc-name"
            value={form.name}
            onChange={(e) => {
              setForm((p) => ({ ...p, name: e.target.value }));
              if (error) setError("");
            }}
          />
        </div>
        <div className="field-group">
          <label htmlFor="acc-email">Email del cliente (Google)</label>
          <input
            id="acc-email"
            type="email"
            value={form.ownerEmail}
            onChange={(e) => {
              setForm((p) => ({ ...p, ownerEmail: e.target.value }));
              if (error) setError("");
            }}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={creating}>
          {creating ? "Creando…" : "Crear"}
        </button>
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>

      <h2 className="section-title">Todas las cuentas</h2>
      {accounts === null ? (
        <p className="empty-state">Cargando cuentas…</p>
      ) : accounts.length === 0 ? (
        <div className="empty-state">Todavía no creaste ninguna cuenta.</div>
      ) : (
        <div className="table-wrap">
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
                  <td>
                    {a.mlSellerId ? (
                      <span className="badge badge-paid">Conectado (seller {a.mlSellerId})</span>
                    ) : (
                      <span className="badge badge-other">Sin conectar</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
