"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

const FEATURES = [
  "Tu cuenta de Mercado Libre, aislada y segura",
  "Rentabilidad real por producto, no estimada",
  "Sincronización con un click",
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  function handleSignIn() {
    setLoading(true);
    signIn("google", { callbackUrl: "/" });
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
            <path
              d="M4 17L9 8L13 14L16 9L20 17"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="login-title">Dashboard Rentabilidad ML</h1>
        <p className="login-subtitle">
          Entrá con tu cuenta de Google para ver la rentabilidad real de tu cuenta de Mercado Libre.
        </p>

        <button
          type="button"
          className="btn google-btn"
          onClick={handleSignIn}
          disabled={loading}
          aria-busy={loading || undefined}
        >
          {loading ? (
            <span className="google-btn-spinner" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.02l7.73 6c4.51-4.18 7.09-10.36 7.09-17.49z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
          )}
          <span>{loading ? "Conectando…" : "Continuar con Google"}</span>
        </button>

        <ul className="login-features">
          {FEATURES.map((feature) => (
            <li key={feature}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M3 8.5L6.2 11.7L13 4.5"
                  fill="none"
                  stroke="var(--positive)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="login-footnote">
        ¿Sos cliente y todavía no tenés cuenta? Pedile a tu administrador que te dé de alta con este mismo email de
        Google.
      </p>
    </div>
  );
}
