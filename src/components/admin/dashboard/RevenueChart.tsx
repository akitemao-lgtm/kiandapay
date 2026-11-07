"use client";

import { useState } from "react";
import { formatKz } from "@/lib/format";

export type DailyRow = { day: string; visits: number; orders: number; sales: number; revenue: number };

const SERIES = "#2a78d6"; // série única (paleta de referência, slot 1)

function shortDay(day: string) {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Faturação por dia: colunas finas, um só eixo, detalhe ao passar o rato/tocar. */
export function RevenueChart({ data }: { data: DailyRow[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => Number(d.revenue)), 0));
  const ticks = [max, max / 2, 0];
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  const a = active !== null ? data[active] : null;

  return (
    <figure>
      <div className="mb-2 h-10 text-sm" aria-live="polite">
        {a ? (
          <p>
            <span className="font-medium">{shortDay(a.day)}</span> · {formatKz(a.revenue)}
            <span className="block text-xs text-gray-500">
              {a.sales} venda(s) · {a.orders} pedido(s) · {a.visits} checkout(s)
            </span>
          </p>
        ) : (
          <p className="text-xs text-gray-500">Toque ou passe o rato numa coluna para ver o dia.</p>
        )}
      </div>
      <div className="flex gap-2">
        <div className="flex h-48 flex-col justify-between pb-5 text-right text-[11px] text-gray-400">
          {ticks.map((t) => <span key={t}>{t >= 1000 ? `${Math.round(t / 1000)}k` : Math.round(t)}</span>)}
        </div>
        <div className="relative h-48 flex-1">
          {/* grelha discreta */}
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-5 flex flex-col justify-between">
            {ticks.map((t) => <div key={t} className="border-t border-gray-100" />)}
          </div>
          <div className="absolute inset-x-0 top-0 bottom-5 flex items-end" onMouseLeave={() => setActive(null)}>
            {data.map((d, i) => {
              const h = (Number(d.revenue) / max) * 100;
              return (
                <button
                  key={d.day}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  aria-label={`${shortDay(d.day)}: ${formatKz(d.revenue)}`}
                  className="flex h-full min-w-0 flex-1 items-end justify-center px-px outline-none"
                >
                  <span
                    className="block w-full max-w-[24px] rounded-t transition-opacity"
                    style={{
                      height: `${Math.max(h, d.revenue > 0 ? 1.5 : 0)}%`,
                      background: SERIES,
                      opacity: active === null || active === i ? 1 : 0.45,
                    }}
                  />
                </button>
              );
            })}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-5 items-end text-[11px] text-gray-400">
            {data.map((d, i) => (
              <span key={d.day} className="flex-1 text-center">
                {i % labelEvery === 0 || i === data.length - 1 ? shortDay(d.day) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-gray-600">Ver em tabela</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead className="text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="py-1 pr-3">Dia</th><th className="py-1 pr-3">Checkouts</th><th className="py-1 pr-3">Pedidos</th><th className="py-1 pr-3">Vendas</th><th className="py-1">Faturação</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((d) => (
                <tr key={d.day}>
                  <td className="py-1 pr-3">{shortDay(d.day)}</td><td className="py-1 pr-3">{d.visits}</td>
                  <td className="py-1 pr-3">{d.orders}</td><td className="py-1 pr-3">{d.sales}</td><td className="py-1">{formatKz(d.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
