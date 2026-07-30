"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { NoAccountState } from "../NoAccountState";

interface MonthlyPoint {
  month: string;
  netProfit: number;
}

export default function TendenciasPage() {
  const [data, setData] = useState<MonthlyPoint[] | null>(null);
  const [noAccount, setNoAccount] = useState(false);

  useEffect(() => {
    fetch("/api/summary?groupBy=month").then((r) => {
      if (r.status === 401) { setNoAccount(true); return; }
      r.json().then(setData);
    });
  }, []);

  if (noAccount) {
    return (
      <div>
        <h1>Tendencias</h1>
        <NoAccountState />
      </div>
    );
  }

  return (
    <div>
      <h1>Tendencias</h1>
      {data === null ? (
        <p className="empty-state">Cargando tendencias…</p>
      ) : data.length === 0 ? (
        <div className="empty-state">Todavía no hay suficientes ventas sincronizadas para mostrar una tendencia.</div>
      ) : (
        <div
          style={{
            width: "100%",
            height: 320,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: 16,
          }}
        >
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" stroke="var(--text-dim)" tick={{ fill: "var(--text-dim)", fontSize: 12 }} />
              <YAxis stroke="var(--text-dim)" tick={{ fill: "var(--text-dim)", fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                labelStyle={{ color: "var(--text-dim)" }}
              />
              <Line type="monotone" dataKey="netProfit" name="Ganancia neta" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
