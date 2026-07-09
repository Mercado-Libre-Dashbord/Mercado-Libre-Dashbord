"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

interface MonthlyPoint {
  month: string;
  netProfit: number;
}

export default function TendenciasPage() {
  const [data, setData] = useState<MonthlyPoint[]>([]);

  useEffect(() => {
    fetch("/api/summary?groupBy=month")
      .then((r) => r.json())
      .then(setData);
  }, []);

  return (
    <div>
      <h1>Tendencias</h1>
      <div style={{ width: "100%", height: 320, background: "#fff", borderRadius: 8, padding: 16 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="netProfit" stroke="#4a7" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
