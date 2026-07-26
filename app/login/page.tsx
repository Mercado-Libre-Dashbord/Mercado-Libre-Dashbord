"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "70vh",
        gap: 16,
      }}
    >
      <h1>Dashboard Rentabilidad ML</h1>
      <p style={{ color: "var(--text-dim)", marginTop: -8 }}>
        Entrá con tu cuenta de Google para ver la rentabilidad de tu cuenta de Mercado Libre.
      </p>
      <button className="btn btn-primary" onClick={() => signIn("google", { callbackUrl: "/" })}>
        Ingresar con Google
      </button>
    </div>
  );
}
