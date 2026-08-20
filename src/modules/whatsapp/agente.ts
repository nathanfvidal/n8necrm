import "server-only";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

import { botConfig } from "../../../config/bot";
import { whatsappGateway } from "./gateway";
import { limparAguardandoHumano } from "./notificacoes";

/**
 * ## Por que `companyId` entra na assinatura das seis (Ciclo 1d)
 *
 * `Conversation` e `BotConfig` são modelos de tenant
 * (`core/tenancy/escopo.ts`). A anotação da fila em `eslint.config.mjs`
 * contava três defeitos ALTA neste arquivo — `pausarIa`, `religarIa` e
 * `responderComoHumano` recebiam `conversationId` cru da Server Action e
 * escolhiam a linha só pelo id. As três funções de config não estavam nessa
 * conta porque já derivavam a empresa do usuário, mas derivavam pela PONTE
 * `companyIdDoUsuario` (`core/users/empresa.ts`), que faz uma consulta a
 * `Membership` por chamada e pega um vínculo ARBITRÁRIO de quem tem mais de
 * um. Desde a Task 2 do Ciclo 1a, `usuarioAtual()` devolve `companyId` — a
 * empresa DA REQUISIÇÃO —, então a ponte aqui virou desvio: as três passaram
 * a receber o `companyId` direto de quem já o tem em mãos, e o import de
 * `companyIdDoUsuario` saiu deste arquivo.
 *
 * `companyId` é o PRIMEIRO parâmetro posicional em todas — mesmo padrão de
 * `queries.ts` neste diretório e de `core/leads/queries.ts`. Obrigatório e
 * posicional: toda chamada existente parou de compilar e precisou ser
 * revisitada. Nada de `AsyncLocalStorage` — este módulo roda em webhook, fila
 * e consumidor, fora do ciclo de requisição, que é onde estado global deixa
 * de valer sem ninguém perceber.
 *
 * A origem do valor é `usuarioAtual().companyId` nas Server Actions e
 * `usuarioAtualOuLogin().companyId` nas páginas — nunca parâmetro de
 * formulário (Server Action é endpoint HTTP público, e um `companyId` de
 * formulário seria forjável), nunca `prisma.company.findFirst()`.
 */

/**
 * Pausa a IA numa conversa DA EMPRESA. Idempotente e NÃO reescreve a autoria:
 * se a conversa já está pausada, quem pausou primeiro continua registrado.
 *
 * O `updateMany` com `iaAtiva: true` no filtro é o que garante isso em uma
 * única instrução — dois humanos abrindo a mesma conversa ao mesmo tempo não
 * disputam a autoria, e o segundo simplesmente afeta 0 linhas. Mesmo idioma
 * de UPDATE condicional usado no lease (`turno.ts`) e no rate limit.
 *
 * O escopo acrescenta `companyId` a esse mesmo `where` (ver
 * `OPERACOES_COM_WHERE` em `core/tenancy/escopo.ts`), então uma conversa de
 * outra empresa cai no mesmo caminho de "0 linhas afetadas" que uma conversa
 * já pausada. Silêncio, e não erro, porque a função já era idempotente por
 * desenho: o chamador nunca soube distinguir "não precisou" de "não achou", e
 * inventar essa distinção agora só para o caso cross-tenant contaria a quem
 * tentar que a conversa existe em algum lugar.
 *
 * `usuarioId` e `companyId` chegam do MESMO `UsuarioAtivo` nos dois
 * chamadores (`actions.ts`), então `iaPausadaPorId` não pode apontar para
 * gente de fora da empresa por esse caminho.
 */
export async function pausarIa(
  companyId: string,
  conversationId: string,
  usuarioId: string
): Promise<void> {
  await prismaDaEmpresa(companyId).conversation.updateMany({
    where: { id: conversationId, iaAtiva: true },
    data: { iaAtiva: false, iaPausadaEm: new Date(), iaPausadaPorId: usuarioId },
  });
}

/**
 * Religa a IA de uma conversa DA EMPRESA e limpa o estado da pausa.
 * Idempotente.
 *
 * Era `update` por id, que o escopo recusa (o `where` de `update` só aceita
 * campo único). Virou `updateMany`, e com isso trocou de contrato num ponto:
 * um id inexistente deixou de lançar `P2025` e passa a afetar 0 linhas. Os
 * dois chamadores (`religarIaAction` e o teste) não distinguiam os casos — a
 * action já devolvia `ResultadoAcao` genérico — e a conversa de outra empresa
 * passa a cair no mesmo silêncio, pelo mesmo motivo descrito em `pausarIa`.
 */
export async function religarIa(companyId: string, conversationId: string): Promise<void> {
  await prismaDaEmpresa(companyId).conversation.updateMany({
    where: { id: conversationId },
    data: { iaAtiva: true, iaPausadaEm: null, iaPausadaPorId: null },
  });
}

/**
 * Lançado quando a empresa não tem linha de `BotConfig`.
 *
 * `BotConfig` tem `@@unique([companyId])` e o seed cria uma linha por empresa
 * (`prisma/seed.ts#semearBotConfig`), então isto é estado que não deveria
 * existir. Existe como erro NOMEADO porque a conversão para `updateMany`
 * (o escopo recusa `update`) trocou um `P2025` do Prisma por "0 linhas
 * afetadas": sem esta checagem, salvar a persona numa empresa sem config
 * viraria um sucesso silencioso, e a tela diria "salvo" sobre nada.
 */
export class ConfigBotAusenteError extends Error {}

function exigirLinhaAtualizada(count: number, companyId: string, operacao: string) {
  if (count === 0) {
    throw new ConfigBotAusenteError(
      `${operacao}: a empresa ${JSON.stringify(companyId)} não tem linha de BotConfig. ` +
        `Uma linha por empresa é criada pelo seed (prisma/seed.ts#semearBotConfig).`
    );
  }
}

/**
 * Lê a config do bot DA EMPRESA.
 *
 * `findFirstOrThrow`, e não `findUniqueOrThrow`: o escopo recusa as operações
 * por chave única por uniformidade, mesmo em `BotConfig`, que é o único
 * modelo de tenant onde `companyId` É único — o raciocínio inteiro está em
 * "Recusa, lançando" (`core/tenancy/escopo.ts`). A consulta resultante é a
 * mesma: `where: { companyId }` sobre uma coluna com `@@unique`.
 */
export async function lerConfigBot(companyId: string) {
  return prismaDaEmpresa(companyId).botConfig.findFirstOrThrow({});
}

export async function salvarConfigBot(
  companyId: string,
  dados: { ativo: boolean; personaNome: string; personaPapel: string; regras: string[]; faq: string },
  usuarioId: string
): Promise<void> {
  const { count } = await prismaDaEmpresa(companyId).botConfig.updateMany({
    where: {},
    data: { ...dados, atualizadoPorId: usuarioId },
  });
  exigirLinhaAtualizada(count, companyId, "salvarConfigBot");
}

/**
 * Restaura persona, regras e FAQ DA EMPRESA a partir de `config/bot.ts`.
 *
 * Este é um dos DOIS únicos momentos em que o arquivo é lido — o outro é o
 * seed (`prisma/seed.ts#semearBotConfig`). Nunca no caminho de resposta ao
 * cliente: nenhum turno consulta o arquivo, e por isso não existe janela em
 * que o bot responda com uma persona diferente da que a tela mostra.
 *
 * `ativo` fica de fora do que é restaurado de propósito: se o interruptor
 * global foi desligado porque o bot estava fazendo besteira, o botão de
 * consertar o texto do prompt não pode religá-lo sozinho — seria o próprio
 * botão de conserto reabrindo o problema. Ver os dois testes em
 * `tests/unit/agente-actions.test.ts`.
 */
export async function restaurarConfigPadrao(companyId: string, usuarioId: string): Promise<void> {
  const { count } = await prismaDaEmpresa(companyId).botConfig.updateMany({
    where: {},
    data: {
      personaNome: botConfig.persona.nome,
      personaPapel: botConfig.persona.papel,
      regras: botConfig.regras,
      faq: botConfig.faq,
      atualizadoPorId: usuarioId,
    },
  });
  exigirLinhaAtualizada(count, companyId, "restaurarConfigPadrao");
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
 * usuário, nunca detalhe interno de infraestrutura. `src/modules/whatsapp/actions.ts`
 * usa `instanceof` para decidir se repassa `error.message` para o cliente ou
 * troca por uma mensagem genérica — ver o comentário de `paraResultadoErro`
 * lá, que é a outra metade desta decisão.
 */
export class RespostaHumanaInvalidaError extends Error {}

/**
 * Envia uma resposta escrita por um humano, numa conversa DA EMPRESA.
 *
 * ## O pior defeito da fila do Ciclo 1a morava aqui
 *
 * A busca da conversa era `prisma.conversation.findUniqueOrThrow({ where: {
 * id: conversationId } })`, com o id vindo cru da Server Action. Um usuário
 * da empresa A que soubesse (ou adivinhasse) o id de uma conversa da empresa
 * B mandava uma mensagem de WhatsApp de verdade **pela instância Evolution da
 * B, para o cliente da B, com o número da B**. Não é leitura de dado alheio:
 * é falar com o cliente de outra empresa se passando por ela.
 *
 * A busca escopada é a PRIMEIRA coisa que toca o banco, antes da pausa e
 * antes do envio, e ela LANÇA (`findFirstOrThrow`) quando a conversa não é da
 * empresa. Por isso a prova de que o defeito fechou não é "a função lançou" —
 * uma função que lançasse depois do envio passaria nesse teste e continuaria
 * vazando. `tests/unit/whatsapp-isolamento.test.ts` afirma que o mock do
 * gateway **não foi chamado**, que nenhuma linha de `WhatsappMessage` nasceu
 * na thread da outra empresa, e que nem a pausa do passo 1 aconteceu.
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
 *
 * Fatia 3 (aviso de conversa aguardando humano) acrescenta um quarto passo,
 * pausa → envia → grava → **limpa**: `limparAguardandoHumano` só depois que
 * os três primeiros terminaram, pelo mesmo motivo de sempre — limpar antes
 * do envio apagaria o sinal de espera por cima de uma mensagem que o cliente
 * nunca recebeu.
 */
export async function responderComoHumano(
  companyId: string,
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

  const escopo = prismaDaEmpresa(companyId);

  // O portão. `findFirstOrThrow` escopado: conversa de outra empresa lança
  // AQUI, antes da pausa e antes do gateway. `companyId` saiu do `select` —
  // ele já está em mãos, e o escopo o injeta no `create` do passo 3.
  const conversa = await escopo.conversation.findFirstOrThrow({
    where: { id: conversationId },
    select: { waId: true },
  });

  // 1. Pausa primeiro — mesmo que tudo depois falhe, a IA fica calada.
  await pausarIa(companyId, conversationId, usuarioId);

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
    // `WhatsappMessage.companyId` é `NOT NULL` desde a Task 1. Ele vinha
    // copiado da conversa (`select: { companyId: true }`); agora vem do
    // ESCOPO — a mesma origem que decidiu QUE conversa é esta.
    //
    // Escrito explícito porque o `$extends` de query NÃO relaxa os TIPOS: o
    // `WhatsappMessageUncheckedCreateInput` continua exigindo `companyId`
    // mesmo com a injeção em vigor (medido aqui com `npm run typecheck`).
    // Para um valor já igual ao escopo, o escopo age como VERIFICADOR
    // (recusa divergência) em vez de preenchedor — ver "O tipo não sabe o
    // que o runtime faz" em `core/tenancy/escopo.ts`.
    await escopo.whatsappMessage.create({
      data: {
        companyId,
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

  // 4. Limpa o estado de espera — só depois do envio E da gravação, nunca
  // antes: mesmo raciocínio da ordem pausa → envia → grava acima. Se isto
  // viesse antes do envio, uma falha do gateway apagaria o sinal de que o
  // cliente ainda espera, e a conversa sumiria do topo da lista sem ninguém
  // ter falado com ele.
  //
  // `limparAguardandoHumano` (`notificacoes.ts`) ainda alcança o `prisma`
  // cru e filtra só por id — é o defeito MÉDIA que a fila do lint anota
  // naquele arquivo, e ele NÃO é desta tarefa. Por este caminho ele não
  // vaza: o `conversationId` que chega aqui já passou pelo portão escopado
  // acima. O outro chamador (`turno.ts`) é que fica dependendo da conversão
  // daquele arquivo.
  await limparAguardandoHumano(conversationId);
}
