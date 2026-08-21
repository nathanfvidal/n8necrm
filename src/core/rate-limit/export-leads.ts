import { checarRateLimit } from "./limiter";

/**
 * Teto de exportações da base de leads, por conta.
 *
 * Irmão de `./login.ts`: o mecanismo (contador atômico em Postgres) mora em
 * `./limiter.ts`, a política mora aqui. Módulo separado da rota porque um
 * arquivo `route.ts` do App Router só pode exportar os métodos HTTP e a
 * configuração de segmento — uma `export const` ali quebraria o build (mesma
 * restrição que motivou `modules/whatsapp/agente-limites.ts`).
 *
 * ## Por que ESTA rota ganhou limite, e não "toda ação de escrita"
 *
 * Um teto genérico sobre escrita autenticada não defende contra o atacante
 * que importa aqui: quem chama uma Server Action já está logado, e sabotagem
 * feita por dentro é LENTA — destruir 300 registros a 5 por minuto nunca
 * encosta num teto de dezenas por minuto. Contra insider, o controle é o log
 * (`AuditLog`), não o limitador.
 *
 * `GET /export/leads` é diferente por natureza: é o único caminho desenhado
 * para tirar a base INTEIRA de clientes (nome + telefone de todo lead) num
 * arquivo só. Uma requisição carrega o que milhares de cliques carregariam.
 * É onde um teto muda o resultado de verdade — e é a operação cujo custo
 * unitário justifica um número próprio, em vez de dividir orçamento com um
 * `UPDATE` de uma linha.
 *
 * ## De onde sai o número (e por que ele é defensável, diferente de um teto global)
 *
 * Exportar é ato deliberado que termina numa planilha aberta na mão de
 * alguém — não existe consumidor automático legítimo: a suíte e2e não toca
 * esta rota, e nenhum agendador a chama (`vercel.json` foi apagado no Ciclo
 * 2d, junto com o resto da plataforma). A maior
 * rajada legítima imaginável é alguém exportar, ver que filtrou errado e
 * exportar de novo; isso é um punhado, não uma dezena.
 *
 * 10 por hora cobre uma pessoa repuxando o relatório a cada 6 minutos
 * durante uma hora inteira — já implausível — e ainda assim prende quem
 * quer varrer a base repetidamente. O ponto não é que 10 seja mágico: é que
 * aqui o limite tem cadência natural para se apoiar, enquanto um teto global
 * sobre escrita não teria.
 *
 * O teto e o log trabalham juntos e não se substituem: mesmo dentro da cota,
 * as 10 exportações deixam 10 linhas de auditoria. O limite contém o volume;
 * o log é o que faz o comportamento aparecer para quem for investigar.
 *
 * ## Cota por conta, não por IP
 *
 * A autorização desta rota é por PAPEL (`exportar_leads`, ADMIN/GESTOR), ou
 * seja, o que está sendo gasto é o direito de exportar de uma pessoa. Chave
 * por IP daria a quem trocasse de rede uma cota nova, e puniria dois gestores
 * atrás do mesmo NAT de escritório — exatamente ao contrário do que se quer.
 * (No login as duas dimensões existem porque lá o atacante é anônimo e não
 * tem conta; aqui ele necessariamente tem.)
 */
export const LIMITE_EXPORT_POR_CONTA = 10;

export const JANELA_EXPORT_MS = 60 * 60_000;

/** `false` quando a conta já esgotou a cota da janela corrente. */
export async function checarLimiteExportLeads(userId: string): Promise<boolean> {
  return checarRateLimit(
    `export:leads:${userId}`,
    LIMITE_EXPORT_POR_CONTA,
    JANELA_EXPORT_MS
  );
}
