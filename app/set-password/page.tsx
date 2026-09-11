"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { MIN_PASSWORD_LENGTH } from "@/lib/credentials-constants";

function SetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar la contraseña.");
        return;
      }
      setDone(true);
      // La contraseña recién quedó guardada; se usa la misma que se acaba
      // de tipear para entrar directo, sin pedirla de nuevo.
      const signInRes = await signIn("credentials", { email: data.email, password, redirect: false });
      if (!signInRes?.error) {
        window.location.href = "/";
      }
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="login-card">
        <h1 className="login-title">Link inválido</h1>
        <p className="login-subtitle">Este link no trae la invitación. Pedile a tu administrador uno nuevo.</p>
      </div>
    );
  }

  return (
    <div className="login-card">
      <h1 className="login-title">Elegí tu contraseña</h1>
      <p className="login-subtitle">Vas a usarla para entrar a partir de ahora, junto con tu email.</p>

      <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
          <label htmlFor="new-password" className="field-hint" style={{ margin: 0 }}>Contraseña nueva</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
          <label htmlFor="confirm-password" className="field-hint" style={{ margin: 0 }}>Repetila</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); if (error) setError(""); }}
          />
        </div>
        {error && <p className="field-error" role="alert" style={{ textAlign: "left" }}>{error}</p>}
        {done && !error && (
          <p className="success-text" role="status" style={{ textAlign: "left" }}>Contraseña guardada. Entrando…</p>
        )}
        <button type="submit" className="btn btn-primary" disabled={loading} aria-busy={loading || undefined}>
          {loading ? "Guardando…" : "Guardar y entrar"}
        </button>
      </form>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <div className="login-shell">
      <Suspense fallback={null}>
        <SetPasswordForm />
      </Suspense>
    </div>
  );
}
