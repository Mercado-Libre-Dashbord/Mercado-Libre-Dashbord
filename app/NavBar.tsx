"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";

interface AccountOption {
  id: string;
  name: string;
}

export function NavBar() {
  const { data: session, status } = useSession();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState("");

  const isAdmin = session?.user?.isAdmin === true;

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/accounts")
      .then((r) => r.json())
      .then((data: { accounts: AccountOption[]; currentAccountId: string | null }) => {
        setAccounts(data.accounts);
        setCurrentAccountId(data.currentAccountId ?? "");
      });
  }, [isAdmin]);

  if (status !== "authenticated") return null;

  async function switchAccount(accountId: string) {
    setCurrentAccountId(accountId);
    await fetch("/api/admin/select-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    window.location.href = "/";
  }

  return (
    <nav>
      <a href="/">Resumen</a>
      <a href="/productos">Productos</a>
      <a href="/ventas">Ventas</a>
      <a href="/tendencias">Tendencias</a>
      {isAdmin && <a href="/admin">Cuentas</a>}
      {isAdmin && accounts.length > 0 && (
        <select value={currentAccountId} onChange={(e) => switchAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <span style={{ marginLeft: "auto", color: "#fff" }}>{session?.user?.email}</span>
      <button onClick={() => signOut({ callbackUrl: "/login" })}>Salir</button>
    </nav>
  );
}
