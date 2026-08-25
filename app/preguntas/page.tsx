"use client";

import { useEffect, useState } from "react";
import { NoAccountState } from "../NoAccountState";

interface QuestionDraft {
  mlQuestionId: string;
  productId: string;
  productTitle: string;
  questionText: string;
  draftAnswer: string;
  dateCreated: string;
}

export default function PreguntasPage() {
  const [questions, setQuestions] = useState<QuestionDraft[] | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<{ id: string; action: "save" | "send" } | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [loadError, setLoadError] = useState("");

  function load() {
    setLoadError("");
    fetch("/api/questions").then(async (r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setLoadError(data.error ?? "No se pudieron cargar las preguntas.");
        setQuestions([]);
        return;
      }
      r.json().then((rows: QuestionDraft[]) => {
        setQuestions(rows);
        setEditing((prev) => {
          const next = { ...prev };
          for (const q of rows) if (next[q.mlQuestionId] === undefined) next[q.mlQuestionId] = q.draftAnswer;
          return next;
        });
      });
    });
  }

  useEffect(load, []);

  if (noAccount) {
    return (
      <div>
        <h1>Preguntas</h1>
        <NoAccountState />
      </div>
    );
  }

  async function respond(mlQuestionId: string, action: "save" | "send") {
    const answer = (editing[mlQuestionId] ?? "").trim();
    if (!answer) {
      setErrors((prev) => ({ ...prev, [mlQuestionId]: "Escribí una respuesta antes de guardar o enviar." }));
      return;
    }
    setErrors((prev) => ({ ...prev, [mlQuestionId]: "" }));
    setSavingId({ id: mlQuestionId, action });
    try {
      const res = await fetch("/api/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mlQuestionId: Number(mlQuestionId), answer, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrors((prev) => ({ ...prev, [mlQuestionId]: data.error ?? "No se pudo guardar." }));
        return;
      }
      if (action === "send") load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <h1>Preguntas</h1>
      <p className="field-hint" style={{ marginBottom: "var(--space-4)" }}>
        Las respuestas sugeridas son un borrador — revisalas antes de mandar. Nada se envía a Mercado Libre solo.
      </p>
      {loadError && <p className="field-error" role="alert" style={{ marginBottom: "var(--space-4)" }}>{loadError}</p>}
      {questions === null ? (
        <p className="empty-state">Cargando preguntas…</p>
      ) : questions.length === 0 ? (
        <div className="empty-state">No tenés preguntas sin responder por ahora.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {questions.map((q) => (
            <div key={q.mlQuestionId} className="day-card" style={{ marginBottom: 0 }}>
              <p className="field-hint" style={{ margin: 0 }}>{q.productTitle}</p>
              <p style={{ margin: "var(--space-2) 0", fontWeight: 600 }}>{q.questionText}</p>
              <div className="field-group">
                <label className="field-hint" htmlFor={`answer-${q.mlQuestionId}`}>
                  Respuesta
                </label>
                <textarea
                  id={`answer-${q.mlQuestionId}`}
                  rows={3}
                  value={editing[q.mlQuestionId] ?? ""}
                  onChange={(e) => {
                    setEditing((prev) => ({ ...prev, [q.mlQuestionId]: e.target.value }));
                    if (errors[q.mlQuestionId]) setErrors((prev) => ({ ...prev, [q.mlQuestionId]: "" }));
                  }}
                  style={{
                    width: "100%",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    borderRadius: "var(--radius-sm)",
                    padding: "9px 10px",
                    fontFamily: "inherit",
                    fontSize: 14,
                    resize: "vertical",
                  }}
                />
                {errors[q.mlQuestionId] && <p className="field-error">{errors[q.mlQuestionId]}</p>}
              </div>
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => respond(q.mlQuestionId, "save")}
                  disabled={savingId?.id === q.mlQuestionId}
                >
                  {savingId?.id === q.mlQuestionId && savingId.action === "save" ? "Guardando…" : "Guardar borrador"}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => respond(q.mlQuestionId, "send")}
                  disabled={savingId?.id === q.mlQuestionId}
                >
                  {savingId?.id === q.mlQuestionId && savingId.action === "send" ? "Enviando…" : "Enviar a Mercado Libre"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
