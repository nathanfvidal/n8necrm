"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import type { LeadChannel } from "@prisma/client";

// Mesma rotulagem de canal do card do kanban (kanban-card.tsx, Task 15) —
// mantida em sincronia de propósito para que o mesmo lead apareça com o
// mesmo texto de canal em qualquer tela.
const rotuloCanal: Record<LeadChannel, string> = {
  FORMULARIO: "Formulário",
  WHATSAPP: "WhatsApp",
  MANUAL: "Manual",
};

export type LeadLinha = {
  id: string;
  contatoNome: string;
  telefone: string | null;
  etapaNome: string;
  responsavelNome: string;
  canal: LeadChannel;
  criadoEm: string;
  criadoEmISO: string;
};

const columnHelper = createColumnHelper<LeadLinha>();

const columns = [
  columnHelper.accessor("contatoNome", {
    header: "Contato",
    // `/leads/[id]` existe a partir da Task 17 — o nome do contato é o link
    // de entrada para a página de detalhe (dados do lead + notas).
    cell: (info) => (
      <Link href={`/leads/${info.row.original.id}`} className="font-medium hover:underline">
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor("telefone", {
    header: "Telefone",
    // `contact` é nullable (Task 13: lead de WhatsApp pode não ter contato
    // identificado ainda) — sem telefone associado, não há nada pra mostrar
    // aqui além de um traço, nunca "null"/"undefined" cru.
    cell: (info) => info.getValue() ?? "—",
  }),
  columnHelper.accessor("etapaNome", { header: "Etapa" }),
  columnHelper.accessor("responsavelNome", { header: "Responsável" }),
  columnHelper.accessor("canal", {
    header: "Canal",
    cell: (info) => rotuloCanal[info.getValue()],
  }),
  columnHelper.accessor("criadoEm", { header: "Criado em" }),
];

/**
 * Tabela de leads com busca livre e filtros por etapa, responsável e
 * intervalo de data de criação.
 *
 * `dados` traz TODOS os leads, para qualquer papel — sem escopo por
 * responsável (decisão de negócio, fix round 1/5: equipe pequena e
 * colaborativa, qualquer vendedor pode precisar do histórico de um lead de
 * outro colega — ver `page.tsx` e `listarLeads`, queries.ts). Os filtros
 * abaixo são só de conveniência de exibição, nunca uma barreira de
 * permissão — não existe, hoje, nenhuma restrição de visibilidade a
 * respeitar aqui.
 */
export function LeadTable({
  dados,
  etapas,
  responsaveis,
}: {
  dados: LeadLinha[];
  etapas: string[];
  responsaveis: string[];
}) {
  const [filtroGlobal, setFiltroGlobal] = useState("");
  const [etapa, setEtapa] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const dadosFiltrados = useMemo(
    () =>
      dados.filter((linha) => {
        if (etapa && linha.etapaNome !== etapa) return false;
        if (responsavel && linha.responsavelNome !== responsavel) return false;
        if (de && linha.criadoEmISO < de) return false;
        if (ate && linha.criadoEmISO > ate) return false;
        return true;
      }),
    [dados, etapa, responsavel, de, ate]
  );

  const table = useReactTable({
    data: dadosFiltrados,
    columns,
    state: { globalFilter: filtroGlobal },
    onGlobalFilterChange: setFiltroGlobal,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // `dadosFiltrados.length` (etapa/responsável/data) NÃO reflete a busca
  // livre — essa é aplicada pelo TanStack Table via `globalFilter`, dentro
  // de `getFilteredRowModel()`. O EmptyState precisa checar as linhas que o
  // TABLE efetivamente calculou depois de TODOS os filtros, não só os que
  // este componente aplica manualmente antes de montar a tabela — senão uma
  // busca sem nenhum resultado renderizaria uma tabela com cabeçalho e corpo
  // vazio em vez do EmptyState.
  const linhasVisiveis = table.getRowModel().rows.length;

  const selectClass = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          placeholder="Buscar..."
          aria-label="Buscar"
          value={filtroGlobal}
          onChange={(e) => setFiltroGlobal(e.target.value)}
          className="max-w-xs"
        />
        <select
          aria-label="Etapa"
          value={etapa}
          onChange={(e) => setEtapa(e.target.value)}
          className={selectClass}
        >
          <option value="">Todas as etapas</option>
          {etapas.map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
        </select>
        <select
          aria-label="Responsável"
          value={responsavel}
          onChange={(e) => setResponsavel(e.target.value)}
          className={selectClass}
        >
          <option value="">Todos os responsáveis</option>
          {responsaveis.map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
        </select>
        <Input
          type="date"
          aria-label="Criado a partir de"
          value={de}
          onChange={(e) => setDe(e.target.value)}
          className="w-40"
        />
        <Input
          type="date"
          aria-label="Criado até"
          value={ate}
          onChange={(e) => setAte(e.target.value)}
          className="w-40"
        />
      </div>

      {linhasVisiveis === 0 ? (
        <EmptyState
          title="Nenhum lead encontrado"
          description="Ajuste a busca ou os filtros para ver outros leads."
        />
      ) : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
