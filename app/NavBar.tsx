"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

interface AccountOption {
  id: string;
  name: string;
}

const NAV_ITEMS = [
  { href: "/", label: "Resumen", icon: "grid" },
  { href: "/resultado-del-dia", label: "Resultado del día", icon: "bolt" },
  { href: "/productos", label: "Productos", icon: "box" },
  { href: "/ventas", label: "Ventas", icon: "cart" },
  { href: "/tendencias", label: "Tendencias", icon: "trend" },
] as const;

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, JSX.Element> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    box: <path d="M3 7.5L12 3l9 4.5-9 4.5-9-4.5zM3 7.5v9L12 21m0-9v9m9-13.5v9L12 21" />,
    cart: (
      <>
        <circle cx="9" cy="20" r="1.4" />
        <circle cx="18" cy="20" r="1.4" />
        <path d="M2.5 3h2.5l2.3 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21.5 7H6" />
      </>
    ),
    trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" strokeLinejoin="round" />,
    users: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 8.2A3.2 3.2 0 1 1 16 14.6M21.5 20c0-3-2-5.2-4.8-5.8" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function NavBar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
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
    <nav className="sidebar" aria-label="Navegación principal">
      <div className="sidebar-brand">
        <span className="sidebar-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M4 17L9 8L13 14L16 9L20 17" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="sidebar-brand-text">Rentabilidad ML</span>
      </div>

      {isAdmin && accounts.length > 0 && (
        <div className="sidebar-account">
          <label>
            <span className="sidebar-account-label">Cuenta activa</span>
            <select value={currentAccountId} onChange={(e) => switchAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="sidebar-links">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`sidebar-link${pathname === item.href ? " active" : ""}`}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </a>
        ))}
        {isAdmin && (
          <a
            href="/admin"
            className={`sidebar-link${pathname === "/admin" ? " active" : ""}`}
            aria-current={pathname === "/admin" ? "page" : undefined}
          >
            <NavIcon name="users" />
            <span>Cuentas</span>
          </a>
        )}
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-user">
        <span className="sidebar-user-email">{session?.user?.email}</span>
        <button className="btn btn-secondary btn-sm" onClick={() => signOut({ callbackUrl: "/login" })}>
          Salir
        </button>
      </div>
    </nav>
  );
}
