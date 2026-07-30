"use client";

import { useSession } from "next-auth/react";

export function NoAccountState() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin === true;

  return (
    <div className="empty-state">
      {isAdmin ? (
        <>
          Todavía no creaste ninguna cuenta. Andá a <a href="/admin">Cuentas</a> y creá la primera — puede ser la
          tuya, con tu propio email de Google.
        </>
      ) : (
        <>Todavía no tenés una cuenta activa. Pedile a tu administrador que te dé de alta con tu email de Google.</>
      )}
    </div>
  );
}
