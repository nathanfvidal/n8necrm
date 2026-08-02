"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";

export type EtapaBarra = { nome: string; total: number; cor: string };

/**
 * Gráfico de barras "leads por etapa" — Recharts só funciona no navegador
 * (mede o container via ResizeObserver), por isso "use client" e por isso
 * este componente recebe `dados` já prontos em vez de buscar no Prisma: um
 * módulo que importa Prisma (`import "server-only"`, ver `core/tasks/
 * service.ts`) nunca pode acabar no bundle de um Client Component — se este
 * arquivo chamasse `listarLeadsPorEtapa` direto, o build falharia (ou pior,
 * vazaria dependência de servidor pro cliente sem avisar).
 *
 * Cada barra usa a cor da própria etapa (`etapa.cor`, a mesma de
 * `StageSummary` e do kanban — Task 15) em vez de uma cor fixa: a leitura
 * do gráfico fica consistente com os cartões de resumo logo acima, sem
 * precisar de legenda separada para "qual barra é qual etapa".
 */
export function ConversionChart({ dados }: { dados: EtapaBarra[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={dados}>
        <XAxis dataKey="nome" fontSize={12} />
        <YAxis allowDecimals={false} fontSize={12} />
        <Tooltip />
        <Bar dataKey="total" radius={[4, 4, 0, 0]}>
          {dados.map((etapa) => (
            <Cell key={etapa.nome} fill={etapa.cor} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
