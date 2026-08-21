import { NextResponse } from "next/server";

import { checarRateLimit } from "@/core/rate-limit/limiter";
import { IP_DESCONHECIDO, obterIpDaRequisicao } from "@/lib/ip";
import { resolverConexaoPorWebhook } from "@/core/conexoes/leitura";
import { gatewayDaCredencial } from "@/modules/whatsapp/gateway/fabrica";
import { ingerirMensagem } from "@/modules/whatsapp/ingest";
import { publicarTurno } from "@/modules/whatsapp/fila";

/**
 * Webhook público que a Evolution chama a cada evento. Tudo sob
 * `/api/whatsapp/*` é público e autentica a si mesmo — ver o comentário em
 * `src/proxy.ts` sobre esse invariante.
 *
 * ## O que mudou no Ciclo 2a, e por quê
 *
 * O path ganhou um segmento: era `/<token>`, virou `/<companyId>/<token>`.
 *
 * O `companyId` é **hipótese, não autoridade** — ele só escolhe ONDE procurar.
 * Quem decide é o token, porque a busca é ESCOPADA naquela empresa:
 *
 * - `companyId` de A + token de A -> encontra. É a única combinação que passa.
 * - `companyId` de B + token de A -> a busca escopada em B não acha o hash de
 *   A -> 404. **Saber o token da empresa A não dá nada na empresa B.**
 * - `companyId` inventado + token qualquer -> 404.
 *
 * Isso é o que permitiu matar `EVOLUTION_COMPANY_ID` (⚠️ R5 da auditoria do
 * Ciclo 1a) **sem** uma consulta global e **sem** exceção nova no lint contra
 * `@/lib/prisma` — a lista está em zero e continua.
 *
 * Esta rota não lê variável de ambiente em linha nenhuma, e isso tem varredura
 * de fonte em `tests/unit/whatsapp-webhook-route.test.ts` — que bane a leitura
 * do ambiente em toda a árvore de `/api/whatsapp`, não só esta variável: a
 * configuração inteira do webhook agora vem da LINHA de `WhatsappConnection`, e
 * uma variável nova aqui seria a mesma dívida com outro nome.
 *
 * E é por isso que um `companyId` de parâmetro aqui não contradiz a regra do
 * programa ("em Server Action a empresa vem de `usuarioAtual()`"): aquela
 * regra existe porque Server Action TEM sessão, e aceitar empresa por
 * parâmetro deixaria alguém autenticado agir na empresa alheia. Um webhook não
 * tem sessão nenhuma para contradizer.
 *
 * A empresa que segue adiante — para a ingestão e para a fila — é
 * `conexao.companyId`, NUNCA o `companyId` do path por si só. As duas
 * coincidem em toda requisição legítima; trocar uma pela outra "porque dá no
 * mesmo" é o que esvaziaria o ciclo, e tem caso de teste com um mock que faz
 * as duas divergirem de propósito.
 *
 * ## Camadas de defesa, nesta ordem
 *
 * 1. **Rate limit por IP** (ou por EMPRESA, quando não há borda confiável — ver
 *    `lib/ip.ts` e o comentário no corpo) — primeiro de todos, e a ordem importa mais agora
 *    que antes: resolver a conexão é uma ida ao BANCO, e deixá-la à frente
 *    daria a quem descobriu o path uma consulta por requisição de graça. Tem
 *    caso de teste. O limite alargado (600/min) continua sendo trava contra
 *    instância comprometida, não throttle por cliente — todo tráfego legítimo
 *    vem de UM IP (a instância Evolution), e ela manda todo tipo de evento por
 *    aqui, não só mensagem, então um limite apertado derrubaria mensagem de
 *    cliente de verdade em 429 na hora de mais tráfego (achado I2 da revisão da
 *    Fatia 1).
 * 2. **Token do path**, resolvido como `sha256` contra `webhookTokenHash`.
 *    A comparação não é mais de tempo constante (era `timingSafeEqual` contra
 *    `WHATSAPP_WEBHOOK_TOKEN`); a defesa nunca foi ela e sim os 256 bits de
 *    entropia, e o que se ganhou em troca é que um dump do banco não entrega
 *    mais uma URL funcional. Ver `core/conexoes/webhook-token.ts`.
 * 3. **Verificação do adapter** (`verificarOrigem`) — o campo `instance` do
 *    corpo contra a instância DAQUELA conexão, não mais contra
 *    `EVOLUTION_INSTANCE` do ambiente.
 *
 * ## Resposta
 *
 * 200 para autenticação/formato ok e todo evento processado (ou duplicado);
 * 500 quando pelo menos um evento falhou de ponta a ponta, deixando o retry
 * NATIVO da Evolution recuperar — seguro porque `ingerirMensagem` (idExterno)
 * e `publicarTurno` (`@@unique([companyId, chaveIdempotencia])`) são idempotentes.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string; token: string }> }
) {
  const { companyId, token } = await params;

  const ip = obterIpDaRequisicao(request);
  // Sem borda confiável (`IP_CABECALHO_CONFIAVEL` ausente — ver `lib/ip.ts`), o
  // IP é o mesmo para todo mundo, e um balde único derrubaria mensagens
  // legítimas de todas as empresas juntas: o limite que existe para conter
  // flood viraria o próprio flood. A empresa do path está disponível ANTES de
  // qualquer consulta, então a degradação não custa a ordem "rate limit antes
  // de resolver a conexão" que a camada 1 garante.
  //
  // Limite conhecido, dito em voz alta: o `companyId` está na URL de webhook
  // que o dono cola no painel da Evolution, então quem a conhecer pode queimar
  // o balde daquela empresa. Um cabeçalho confiável fecha isso; nada mais fecha.
  const chaveDeTaxa =
    ip === IP_DESCONHECIDO
      ? `whatsapp:webhook:empresa:${companyId}`
      : `whatsapp:webhook:${ip}`;
  const permitido = await checarRateLimit(chaveDeTaxa, 600, 60_000);
  if (!permitido) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    // JSON malformado — confirma sem processar, e sem gastar uma consulta:
    // não deixa a Evolution reentregar um payload que nunca vai parsear.
    return NextResponse.json({ ok: true });
  }

  const conexao = await resolverConexaoPorWebhook(companyId, token);
  if (!conexao) {
    // 404, e não 401/403: não confirma a quem está adivinhando que este path
    // sequer existe. Mesma resposta para "token errado", "empresa errada" e
    // "conexão desativada" — distinguir seria dizer qual metade acertou, e
    // quem soubesse disso passaria a enumerar empresas em vez de tokens. Um
    // caso de teste compara status, corpo e cabeçalhos das duas recusas.
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const gateway = gatewayDaCredencial(conexao);

  if (!gateway.verificarOrigem(corpo)) {
    // Instância desconhecida: a Evolution mandou um evento de uma instância
    // que não é a desta conexão. Nada é escrito.
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const eventos = gateway.normalizarEventos(corpo);

  let algumEventoFalhou = false;
  for (const evento of eventos) {
    try {
      const resultado = await ingerirMensagem(evento, {
        companyId: conexao.companyId,
        connectionId: conexao.id,
      });
      // Sem `catch` de duplicata desde o Ciclo 2d: `publicarTurno` deixou de
      // lançar em republicação da mesma chave (o `skipDuplicates` de
      // `fila/postgres.ts`). O caminho de redelivery continua existindo — a
      // Evolution reentrega o payload inteiro quando esta rota responde 500 — e
      // continua sendo inofensivo; ele só deixou de precisar de tradução aqui.
      await publicarTurno({
        companyId: resultado.companyId,
        conversationId: resultado.conversationId,
        seq: resultado.bufferSeq,
      });
    } catch (erro) {
      // Uma falha de verdade não impede os DEMAIS eventos do mesmo payload de
      // serem tentados — mas marca a resposta como falha, para a Evolution
      // reentregar o payload inteiro depois. Reentregar é seguro: as duas
      // pontas são idempotentes.
      //
      // O `companyId` NÃO entra neste log de propósito: ele já está no path
      // que o log de acesso registra, e repeti-lo aqui só aumentaria a
      // superfície. O erro do cofre, quando é ele, já se explica sozinho.
      console.error("Falha ao ingerir/publicar mensagem do WhatsApp:", erro);
      algumEventoFalhou = true;
    }
  }

  return NextResponse.json({ ok: !algumEventoFalhou }, { status: algumEventoFalhou ? 500 : 200 });
}
