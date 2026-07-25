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
      <button onClick={() => signIn("google", { callbackUrl: "/" })}>Ingresar con Google</button>
    </div>
  );
}
