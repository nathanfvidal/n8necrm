import { notFound } from "next/navigation";

import { client } from "../../config/client";
import type { ClientConfig } from "../../config/client.schema";

// Nome deliberadamente "module-gate", não "modules": a regra do ESLint da
// Task 4 (no-restricted-imports em src/core/**) usa os padrões **/modules e
// **/modules/*, propositalmente amplos para pegar tanto "@/modules" quanto
// grafias relativas como "../../modules" — ver eslint.config.mjs. Um arquivo
// chamado src/lib/modules.ts colide com esse padrão por coincidência de
// nome, sem ter nenhuma relação com a fronteira core/modules que a regra
// protege. Renomear aqui evita bloquear código de src/core/ que legitimamente
// precise de moduloAtivo/exigirModulo (ex.: um helper de auditoria que pula
// log para módulo desligado) com um erro que aponta para uma regra errada.

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
