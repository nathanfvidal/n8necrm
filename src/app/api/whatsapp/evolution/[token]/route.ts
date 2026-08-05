import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { checarRateLimit } from "@/core/rate-limit/limiter";
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
 *    deste limiter (existia desde a Task 11, sem uso). Protege contra
 *    flood mesmo que o token vaze.
 * 3. **Verificação do adapter** (`whatsappGateway.verificarOrigem`) — conferência
 *    específica do protocolo Evolution (campo `instance` do corpo).
 *
 * Devolve 200 rápido para qualquer coisa que não seja um erro de
 * autenticação — inclusive payload malformado ou evento que não é mensagem
 * — porque a Evolution reage a não-200 com retry, e um retry-storm sobre um
 * payload que nunca vai processar só piora a situação. Erros DE INGESTÃO
 * (banco fora do ar, etc.) também não derrubam a resposta: um evento que
 * falha na ingestão é logado e pulado, os demais eventos do mesmo payload
 * continuam sendo processados.
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

  const ip = obterIp(request);
  // 60 req/min por IP: generoso o bastante para o tráfego normal de UM
  // número de WhatsApp (mesmo em pico, várias mensagens por segundo de
  // clientes diferentes não chega perto disso), apertado o bastante para
  // conter um flood de quem descobriu o token pelo log.
  const permitido = await checarRateLimit(`whatsapp:webhook:${ip}`, 60, 60_000);
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

  for (const evento of eventos) {
    try {
      const resultado = await ingerirMensagem(evento);
      if (!resultado.duplicada) {
        await publicarTurno({ conversationId: resultado.conversationId, seq: resultado.bufferSeq });
      }
    } catch (erro) {
      // Uma falha ao ingerir UM evento (banco fora do ar, etc.) não deve
      // impedir os demais eventos do mesmo payload de serem processados,
      // nem fazer a rota devolver um status que faria a Evolution
      // reentregar o payload INTEIRO (reprocessando eventos que já deram
      // certo). Logamos e seguimos.
      console.error("Falha ao ingerir mensagem do WhatsApp:", erro);
    }
  }

  return NextResponse.json({ ok: true });
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

function obterIp(request: Request): string {
  // Vercel injeta x-forwarded-for com o IP real do cliente na frente da
  // cadeia de proxies — pegamos só o primeiro valor (o mais próximo do
  // cliente original), nunca confiando cegamente no header inteiro (um
  // cliente poderia mandar seu próprio x-forwarded-for, mas isso só
  // afetaria a CHAVE do rate limit, nunca autenticação).
  const encaminhado = request.headers.get("x-forwarded-for");
  return encaminhado?.split(",")[0]?.trim() ?? "desconhecido";
}
