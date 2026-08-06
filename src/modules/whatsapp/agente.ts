import "server-only";

import { prisma } from "@/lib/prisma";

import { BOT_CONFIG_ID } from "../../../config/bot";
import { whatsappGateway } from "./gateway";

/**
 * Pausa a IA numa conversa. Idempotente e NÃO reescreve a autoria: se a
 * conversa já está pausada, quem pausou primeiro continua registrado.
 *
 * O `updateMany` com `iaAtiva: true` no filtro é o que garante isso em uma
 * única instrução — dois humanos abrindo a mesma conversa ao mesmo tempo não
 * disputam a autoria, e o segundo simplesmente afeta 0 linhas. Mesmo idioma
 * de UPDATE condicional usado no lease (`turno.ts`) e no rate limit.
 */
export async function pausarIa(conversationId: string, usuarioId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, iaAtiva: true },
    data: { iaAtiva: false, iaPausadaEm: new Date(), iaPausadaPorId: usuarioId },
  });
}

/** Religa a IA e limpa o estado da pausa. Idempotente. */
export async function religarIa(conversationId: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { iaAtiva: true, iaPausadaEm: null, iaPausadaPorId: null },
  });
}

export async function lerConfigBot() {
  return prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
}

export async function salvarConfigBot(
  dados: { ativo: boolean; personaNome: string; personaPapel: string; regras: string[]; faq: string },
  usuarioId: string
) {
  return prisma.botConfig.update({
    where: { id: BOT_CONFIG_ID },
    data: { ...dados, atualizadoPorId: usuarioId },
  });
}

/** Teto de tamanho de uma mensagem enviada pelo humano — o WhatsApp corta bem
 * acima disto, mas um campo sem limite é um campo que alguém cola um arquivo
 * inteiro dentro. */
const MAX_CARACTERES_RESPOSTA_HUMANA = 4000;

/**
 * Erro de validação de `responderComoHumano` — mensagem vazia ou acima do
 * limite. Distinto de qualquer outra falha da função (gateway fora do ar,
 * banco indisponível) porque o TEXTO desta mensagem é seguro para chegar até
 * a tela de quem está atendendo: descreve uma entrada inválida do próprio
 * usuário, nunca detalhe interno de infraestrutura. `src/core/whatsapp/actions.ts`
 * usa `instanceof` para decidir se repassa `error.message` para o cliente ou
 * troca por uma mensagem genérica — ver o comentário de `paraResultadoErro`
 * lá, que é a outra metade desta decisão.
 */
export class RespostaHumanaInvalidaError extends Error {}

/**
 * Envia uma resposta escrita por um humano.
 *
 * ## A ordem importa e é contraintuitiva: pausa → envia → grava
 *
 * O envio é externo e não participa de transação, então alguma falha vai
 * acontecer. Esta é a única ordem em que TODA falha erra para o lado seguro:
 *
 * | Falha        | Resultado                                                        |
 * |--------------|------------------------------------------------------------------|
 * | Envio falha  | Bot pausado, nada enviado. O humano vê o erro e repete           |
 * | Gravação falha | Cliente recebeu, bot pausado, inbox sem a linha. Chato, não grave |
 * | (se gravasse primeiro) envio falha | Inbox mostrando mensagem que o cliente nunca recebeu — o pior dos três |
 *
 * Nenhum caminho deixa a IA respondendo por cima de um humano. É a mesma
 * semântica dos fluxos n8n que já rodam em produção (`Bots/01_-_ENTRADA_E_SAIDA`,
 * nó `pausaAtendimentoIA`): quem escreve, pausa.
 */
export async function responderComoHumano(
  conversationId: string,
  texto: string,
  usuarioId: string
): Promise<void> {
  const conteudo = texto.trim();
  if (conteudo.length === 0) {
    throw new RespostaHumanaInvalidaError("Mensagem vazia — nada a enviar.");
  }
  if (conteudo.length > MAX_CARACTERES_RESPOSTA_HUMANA) {
    throw new RespostaHumanaInvalidaError(
      `Mensagem acima do limite de ${MAX_CARACTERES_RESPOSTA_HUMANA} caracteres.`
    );
  }

  const conversa = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { waId: true },
  });

  // 1. Pausa primeiro — mesmo que tudo depois falhe, a IA fica calada.
  await pausarIa(conversationId, usuarioId);

  // 2. Envia. Loga no `conversationId` (nunca o texto nem `conversa.waId` —
  // é o telefone do cliente, dado pessoal) para deixar rastro de quando o
  // humano precisou repetir o envio.
  let envio: { idExterno: string };
  try {
    envio = await whatsappGateway.enviarTexto(conversa.waId, conteudo);
  } catch (erro) {
    console.error(
      `Falha ao enviar resposta humana (conversationId=${conversationId}) — IA pausada, nada enviado.`,
      erro
    );
    throw erro;
  }

  // 3. Grava. Se isto falhar, o cliente JÁ recebeu a mensagem (passo 2 teve
  // sucesso) e ela não vai aparecer no inbox — o pior caso que a ordem
  // pausa→envia→grava não elimina, só limita. `idExterno` (id do gateway,
  // não dado pessoal) fica no log para permitir reconciliação manual.
  try {
    await prisma.whatsappMessage.create({
      data: {
        conversationId,
        idExterno: envio.idExterno,
        direcao: "SAIDA",
        autor: "HUMANO",
        tipo: "TEXTO",
        texto: conteudo,
        processadoEm: new Date(),
      },
    });
  } catch (erro) {
    console.error(
      `Falha ao gravar resposta humana já enviada (conversationId=${conversationId}, ` +
        `idExterno=${envio.idExterno}) — cliente recebeu a mensagem, mas ela não aparece no inbox.`,
      erro
    );
    throw erro;
  }
}
