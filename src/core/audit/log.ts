import { prisma } from "@/lib/prisma";

/**
 * Registra uma entrada no audit log: quem fez o quê, em qual entidade, com
 * o estado antes/depois da mudança.
 *
 * `antes`/`depois` passam por `JSON.parse(JSON.stringify(...))` para virar
 * um valor "JSON puro" aceito pelo campo `Json` do Prisma. Isso tem efeitos
 * colaterais que quem chama esta função precisa conhecer:
 *
 * - `Date` vira string ISO (Date.prototype.toJSON = toISOString). Ao ler de
 *   volta, `antes.criadoEm` é string, não instância de Date.
 * - `Prisma.Decimal` (ex.: `Lead.valorEstimado`) vira string, porque a
 *   classe Decimal do Prisma define `toJSON()` retornando o valor como
 *   texto (evita perda de precisão que um `number` teria, mas quem lê de
 *   volta precisa fazer `new Prisma.Decimal(...)` ou `Number(...)` para
 *   voltar a operar com o valor).
 * - Propriedades com valor `undefined` são omitidas do resultado (regra
 *   padrão do `JSON.stringify`). `null` explícito é preservado.
 * - `antes`/`depois` não informados (`undefined`) não são enviados ao
 *   Prisma — a coluna fica com o padrão do banco (NULL), e não sofrem a
 *   coerção acima.
 */
export async function registrarAuditoria(params: {
  userId: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  antes?: unknown;
  depois?: unknown;
  ip?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      acao: params.acao,
      entidade: params.entidade,
      entidadeId: params.entidadeId,
      antes: params.antes === undefined ? undefined : JSON.parse(JSON.stringify(params.antes)),
      depois: params.depois === undefined ? undefined : JSON.parse(JSON.stringify(params.depois)),
      ip: params.ip,
    },
  });
}
