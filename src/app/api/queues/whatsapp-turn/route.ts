import { NextResponse } from "next/server";

import { segredoConfere } from "@/lib/segredo";
import { drenarFila } from "@/modules/whatsapp/fila/consumidor";

/**
 * O TICK da fila de turnos.
 *
 * ## O que mudou, e por que a mudança é de segurança e não de encanamento
 *
 * Até o Ciclo 2d esta rota era um consumidor de push do Vercel Queues, e a
 * documentação da Vercel garantia que ela ficava "completamente air-gapped da
 * internet… só pode ser invocada pela infraestrutura interna de fila da
 * Vercel". A inspeção do código-fonte de `@vercel/queue` mostrava que o SDK
 * **não fazia nenhuma verificação de assinatura nem OIDC**: confiava
 * inteiramente naquela garantia de rede. O segredo compartilhado ia no PAYLOAD
 * do job como segunda camada.
 *
 * Fora da Vercel a primeira camada **deixa de existir**. Três consequências, e
 * as três estão tratadas aqui:
 *
 * 1. **A rota é alcançável da internet**, e o segredo passa a ser a única
 *    defesa. Ele sai do payload — que agora nem existe, porque o job é uma
 *    linha do nosso Postgres e não atravessa rede nenhuma — e vira o cabeçalho
 *    `x-fila-segredo` de quem ACIONA. O que precisa ser autenticado mudou de
 *    "esta mensagem" para "esta chamada", e cabeçalho é onde credencial de
 *    chamada mora.
 * 2. **A comparação** é `segredoConfere` (`@/lib/segredo`), sem o oráculo de
 *    comprimento que o `if (a.length !== b.length) return false` desta rota
 *    tinha. A defesa real continua sendo os 256 bits de entropia.
 * 3. **A resposta a segredo inválido é 404**, não 401 — mesma decisão da rota
 *    do webhook: não confirma a quem está adivinhando que este path sequer
 *    existe.
 *
 * ## O caminho não mudou de nome, de propósito
 *
 * `/api/queues/whatsapp-turn` continua igual porque `src/proxy.ts` já tem a
 * exceção daquele prefixo, com caso em `tests/unit/proxy-matcher.test.ts`.
 * Renomear custaria mexer nos dois por zero ganho.
 *
 * ## Quem chama isto
 *
 * Qualquer agendador: `pg_cron`+`pg_net` do Supabase, `cron`+`curl` numa VPS,
 * um workflow do n8n. **Nada chama por padrão** — quem tiver um Node sempre
 * ligado deve preferir `npm run fila:worker`, que faz o mesmo trabalho sem
 * abrir porta.
 *
 * ## `esgotou: false` é um pedido
 *
 * O corpo devolve o resultado da drenagem. `esgotou: false` significa que
 * sobrou trabalho pronto e que vale chamar de novo agora, sem esperar o próximo
 * agendamento.
 *
 * ## O segredo é lido DENTRO da função
 *
 * Validar em escopo de módulo já derrubou o build deste projeto uma vez
 * (`modules/whatsapp/gateway/index.ts`): `next build` avalia módulos
 * alcançáveis para coletar configuração de rota, e a variável não existe nesse
 * momento. Há caso de teste para isso.
 *
 * ## Sem `export const maxDuration`
 *
 * Ele existia aqui e era o teto do plano Hobby da Vercel — configuração de
 * plataforma, não decisão nossa. O teto passou a ser `TEMPO_MAX_TURNO_MS`
 * (`fila/consumidor.ts`), em código, e vale para os DOIS gatilhos. Reintroduzir
 * a linha aqui recriaria o acoplamento que este ciclo desfez.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.WHATSAPP_QUEUE_SECRET ?? "";
  const recebido = request.headers.get("x-fila-segredo") ?? "";

  if (!segredoConfere(recebido, esperado)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const resultado = await drenarFila();
  return NextResponse.json({ ok: true, ...resultado });
}
