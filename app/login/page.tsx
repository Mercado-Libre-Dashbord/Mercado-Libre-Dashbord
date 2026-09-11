"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, getProviders } from "next-auth/react";

const FEATURES = [
  "Tu cuenta de Mercado Libre, aislada y segura",
  "Rentabilidad real por producto, no estimada",
  "Sincronización con un click",
];

/**
 * Los logins que ofrece la app, en el orden en que se muestran.
 *
 * Cuáles aparecen no se decide acá: se cruzan contra los que el servidor
 * tiene realmente configurados (`getProviders`). Así, en una instalación sin
 * credenciales de Azure, el botón de Microsoft no existe en vez de existir y
 * fallar al tocarlo.
 */
const PROVIDERS = [
  {
    id: "google",
    label: "Google",
    // Gmail es el caso obvio; el resto no, y el vendedor que entra con
    // Hotmail necesita ver cuál es su botón sin tener que adivinarlo.
    hint: "Gmail o Workspace",
    icon: (
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.02l7.73 6c4.51-4.18 7.09-10.36 7.09-17.49z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    ),
  },
  {
    id: "azure-ad",
    label: "Microsoft",
    hint: "Hotmail u Outlook",
    icon: (
      <svg viewBox="0 0 23 23" width="18" height="18" aria-hidden="true">
        <rect x="1" y="1" width="10" height="10" fill="#F25022" />
        <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
        <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
        <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
      </svg>
    ),
  },
] as const;

/**
 * Qué decirle al usuario cuando NextAuth lo devuelve con un error.
 *
 * `AccessDenied` es el que devuelve nuestra propia puerta de entrada cuando
 * el proveedor no demostró que el email es de quien dice ser
 * (ver lib/auth-identity.ts). El motivo exacto queda en el log del servidor:
 * mostrarlo acá sería decirle a un atacante qué claim le falta falsear.
 */
const ERROR_MESSAGE: Record<string, string> = {
  AccessDenied:
    "No pudimos verificar tu email con ese proveedor. Probá con la otra opción, o escribinos si el problema sigue.",
  OAuthAccountNotLinked:
    "Ese email ya entró antes con el otro proveedor. Usá el mismo botón que la primera vez.",
  Configuration: "El login no está configurado del todo. Avisale al administrador.",
  Verification: "El enlace de acceso ya venció. Probá entrar de nuevo.",
};

function LoginCard() {
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [available, setAvailable] = useState<string[] | null>(null);
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");

  useEffect(() => {
    getProviders()
      .then((providers) => setAvailable(providers ? Object.keys(providers) : []))
      // Si la consulta falla se muestran los dos, no uno elegido a dedo: con
      // el peor caso de mostrar uno que no está configurado, el usuario
      // igual tiene el otro para entrar. Cayendo a un único proveedor, una
      // instalación que sólo tenga el otro se queda sin forma de entrar.
      .catch(() => setAvailable(null));
  }, []);

  function handleSignIn(providerId: string) {
    setPendingProvider(providerId);
    signIn(providerId, { callbackUrl: "/" });
  }

  const visible = PROVIDERS.filter((p) => available === null || available.includes(p.id));
  const errorMessage = errorCode ? ERROR_MESSAGE[errorCode] ?? ERROR_MESSAGE.AccessDenied : null;

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
            <path d="M4 17L9 8L13 14L16 9L20 17" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h1 className="login-title">Dashboard Rentabilidad ML</h1>
        <p className="login-subtitle">
          Entrá con tu cuenta de Google o de Microsoft para ver la rentabilidad real de tu cuenta de Mercado Libre.
        </p>

        {errorMessage && (
          <p className="field-error login-error" role="alert">
            {errorMessage}
          </p>
        )}

        <p className="login-providers-caption">Continuar con</p>
        <div className="login-providers">
          {visible.map((provider) => {
            const loading = pendingProvider === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                className="btn provider-btn"
                onClick={() => handleSignIn(provider.id)}
                // Se deshabilitan los dos mientras uno navega: tocar el
                // segundo a mitad de la redirección del primero abandonaba el
                // flujo de OAuth por la mitad.
                disabled={pendingProvider !== null}
                aria-busy={loading || undefined}
                aria-label={`Continuar con ${provider.label}`}
              >
                <span className="provider-btn-icon" aria-hidden="true">
                  {loading ? <span className="google-btn-spinner" /> : provider.icon}
                </span>
                <span className="provider-btn-label">{loading ? "Conectando…" : provider.label}</span>
                <span className="provider-btn-hint">{provider.hint}</span>
              </button>
            );
          })}
        </div>

        <p className="login-linknote">
          Da igual con cuál entres: si el email es el mismo, es la misma cuenta y los mismos datos.
        </p>

        <ul className="login-features">
          {FEATURES.map((feature) => (
            <li key={feature}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3 8.5L6.2 11.7L13 4.5" fill="none" stroke="var(--positive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="login-footnote">
        ¿Sos cliente y todavía no tenés cuenta? Pedile a tu administrador que te dé de alta con este mismo email.
      </p>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams obliga a un límite de Suspense para que la página siga
  // pudiendo prerenderizarse estáticamente.
  return (
    <Suspense fallback={<div className="login-shell" />}>
      <LoginCard />
    </Suspense>
  );
}
