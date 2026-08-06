import crypto from "node:crypto";

import { NextResponse } from "next/server";
import { DuplicateMessageError } from "@vercel/queue";

import { checarRateLimit } from "@/core/rate-limit/limiter";
import { obterIpDaRequisicao } from "@/lib/ip";
import { whatsappGateway } from "@/modules/whatsapp/gateway";
import { ingerirMensagem } from "@/modules/whatsapp/ingest";
import { publicarTurno } from "@/modules/whatsapp/fila";

/**
 * Webhook público que a Evolution chama a cada evento (mensagem recebida,
 * atualização de conexão, etc.). Tudo sob `/api/whatsapp/*` é público e
 * autentica a si mesmo — ver o comentário em `src/proxy.ts` sobre esse
 * invariante.
 *
 * ## Camadas de defesa, nesta ordem
 *
 * 1. **Token imprevisível no path**, comparado com `timingSafeEqual` — a
 *    Evolution self-hosted não assina webhooks (sem HMAC, ao contrário do
 *    Cloud API), então este token é a única barreira contra alguém que não
 *    seja a própria Evolution chamar esta rota. Ressalva registrada no
 *    plano da Fatia 1: um token no PATH aparece em log de acesso (do
 *    Vercel, de qualquer proxy no meio) — mitigação aceita para esta fatia,
 *    revisitável se algum dia importar rotacionar o token periodicamente.
 * 2. **Rate limit por IP**, via `checarRateLimit` — primeiro chamador real
 *    deste limiter (existia desde a Task 11, sem uso). Fix round 1/5,
 *    achado do revisor (I2): isto protege contra flood/abuso de quem
 *    descobriu o token, NÃO é (e nunca foi) uma proteção de custo por
 *    cliente — todo tráfego legítimo vem de UM IP (a instância Evolution),
 *    e a Evolution manda TODO tipo de evento aqui, não só mensagem (um
 *    burst de confirmação de leitura/presença podia esgotar um limite
 *    apertado e derrubar mensagem de cliente de verdade em 429 bem na hora
 *    de mais tráfego). O limite foi alargado para refletir isso — é uma
 *    trava contra uma instância Evolution com bug/comprometida, não um
 *    throttle por cliente. A proteção de CUSTO real (N conversas = N leases
 *    paralelos = N chamadas à OpenAI, todas dentro do orçamento de UM IP)
 *    é outra: um teto de respostas de IA por conversa por hora, em
 *    `turno.ts` — e, fora do código, um teto de gasto mensal configurado no
 *    painel da OpenAI (isso é responsabilidade humana, não algo que este
 *    código possa impor).
 * 3. **Verificação do adapter** (`whatsappGateway.verificarOrigem`) — conferência
 *    específica do protocolo Evolution (campo `instance` do corpo).
 *
 * ## Resposta
 *
 * Devolve 200 para autenticação/formato ok E todo evento processado (ou
 * genuinamente duplicado — ver `DuplicateMessageError` abaixo) com sucesso.
 * Devolve 500 quando pelo menos um evento falhou de ponta a ponta (ingestão
 * OU publicação) — fix round 1/5, achado IMPORTANTE do revisor (I3): antes,
 * esta rota sempre devolvia 200, então uma falha ao publicar o turno
 * (rede, fila fora do ar) tornava a mensagem invisível para a Evolution — e
 * mesmo que a Evolution tentasse reentregar por conta própria, o código
 * verificava `resultado.duplicada` e PULAVA a publicação nesse caminho,
 * então o reenvio nunca curava o problema: a mensagem ficava presa para
 * sempre com `processadoEm: null`. Agora: (a) publica o turno em TODO
 * evento, inclusive os reconhecidos como duplicados — o `idempotencyKey`
 * da fila já torna essa republicação um no-op seguro; (b) devolve 500
 * quando algo falha de verdade, deixando o retry NATIVO da Evolution
 * (ela reenvia webhook em erro) fazer a recuperação — seguro agora que
 * tanto `ingerirMensagem` (idExterno) quanto `publicarTurno`
 * (idempotencyKey) são idempotentes de ponta a ponta.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const tokenEsperado = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!tokenEsperado) {
    console.error("WHATSAPP_WEBHOOK_TOKEN não configurado — recusando todo webhook do WhatsApp.");
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (!tokenValido(token, tokenEsperado)) {
    // 404, não 401/403: não confirma pra quem está tentando adivinhar o
    // token que este path SEQUER EXISTE.
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const ip = obterIpDaRequisicao(request);
  // Fix round 1/5 (I2): 60/min era, na prática, um teto GLOBAL (todo
  // tráfego legítimo vem de um único IP — a instância Evolution), e a
  // Evolution manda todo tipo de evento por aqui, não só mensagem — um
  // burst de confirmação de leitura/presença podia consumir o teto e
  // derrubar mensagem de cliente de verdade em 429. 600/min continua
  // barrando um flood real (instância comprometida/com bug), sem se
  // comportar como throttle por cliente.
  const permitido = await checarRateLimit(`whatsapp:webhook:${ip}`, 600, 60_000);
  if (!permitido) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    // JSON malformado — confirma sem processar, não deixa a Evolution
    // reentregar um payload que nunca vai conseguir parsear.
    return NextResponse.json({ ok: true });
  }

  if (!whatsappGateway.verificarOrigem(corpo)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const eventos = whatsappGateway.normalizarEventos(corpo);

  let algumEventoFalhou = false;
  for (const evento of eventos) {
    try {
      const resultado = await ingerirMensagem(evento);
      try {
        await publicarTurno({ conversationId: resultado.conversationId, seq: resultado.bufferSeq });
      } catch (erroPublicacao) {
        if (erroPublicacao instanceof DuplicateMessageError) {
          // Esperado no caminho de redelivery: o job para este MESMO
          // bufferSeq já tinha sido publicado antes (pela ingestão
          // original, ou por uma tentativa anterior desta mesma
          // redelivery) — a fila já deduplicou por `idempotencyKey`, não é
          // uma falha.
          continue;
        }
        throw erroPublicacao;
      }
    } catch (erro) {
      // Uma falha de verdade (banco fora do ar, fila indisponível) não deve
      // impedir os DEMAIS eventos do mesmo payload de serem tentados — mas
      // marca a resposta como falha (ver `algumEventoFalhou` abaixo) para a
      // Evolution reentregar o payload inteiro depois. Reentregar é seguro:
      // `ingerirMensagem` (idExterno) e `publicarTurno` (idempotencyKey)
      // são idempotentes de ponta a ponta.
      console.error("Falha ao ingerir/publicar mensagem do WhatsApp:", erro);
      algumEventoFalhou = true;
    }
  }

  return NextResponse.json({ ok: !algumEventoFalhou }, { status: algumEventoFalhou ? 500 : 200 });
}

function tokenValido(recebido: string, esperado: string): boolean {
  const bufferRecebido = Buffer.from(recebido);
  const bufferEsperado = Buffer.from(esperado);
  // timingSafeEqual exige buffers do MESMO tamanho — comparar tamanhos
  // primeiro (uma comparação de tamanho não vaza informação útil sobre o
  // conteúdo do token) evita que um token de tamanho diferente lance em vez
  // de simplesmente ser rejeitado.
  if (bufferRecebido.length !== bufferEsperado.length) return false;
  return crypto.timingSafeEqual(bufferRecebido, bufferEsperado);
}
