import { notFound } from "next/navigation";

import { client } from "../../config/client";
import type { ClientConfig } from "../../config/client.schema";

// Derivado do schema (config/client.schema.ts) em vez de repetir a lista de
// módulos aqui: se um fork adicionar/remover um módulo no enum do Zod, este
// tipo acompanha automaticamente, sem risco de as duas listas divergirem.
export type ModuloNome = ClientConfig["modulos"][number];

export function moduloAtivo(nome: ModuloNome): boolean {
  return client.modulos.includes(nome);
}

// Chamar no topo de uma page.tsx (ou layout.tsx) de um módulo opcional.
// Implementa a spec 3.4: módulo desligado não some só do menu — a rota em
// si devolve 404, então digitar a URL diretamente não contorna o gating.
export function exigirModulo(nome: ModuloNome): void {
  if (!moduloAtivo(nome)) notFound();
}
