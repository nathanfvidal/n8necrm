import "server-only";

import { DuplicateMessageError } from "@vercel/queue";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

import { publicarTurno, type TurnoJob } from "./fila";
import { gatewayDaConversa } from "./gateway/fabrica";
import { llmProvider } from "./llm";
import type { AutorMensagemContexto } from "./llm/tipos";
import { limparAguardandoHumano, marcarAguardandoHumano } from "./notificacoes";
import { montarPromptSistema } from "./prompt";

export type { TurnoJob } from "./fila";

/** O cliente já amarrado a uma empresa — o único caminho deste módulo ao banco. */
type ClienteDaEmpresa = ReturnType<typeof prismaDaEmpresa>;

/**
 * ## De onde vem o `companyId` deste módulo, e por que ele viaja no JOB
 *
 * `turno.ts` roda fora de qualquer requisição de usuário: é um consumidor de
 * fila. Não há sessão, não há `usuarioAtual()`, e o `conversationId` chega do
 * payload do job. Havia duas saídas:
 *
 * 1. Ler a `Conversation` sem escopo para descobrir a empresa dela. Isso exige
 *    o `prisma` cru — ou seja, manteria este arquivo na exceção do lint, que é
 *    exatamente o que a conversão veio fechar.
 * 2. Fazer a empresa viajar no job, resolvida por quem TEM origem sã para ela:
 *    `ingerirMensagem` (`ingest.ts`), que a recebe no contexto montado pela
 *    rota do webhook a partir da CONEXÃO resolvida pelo token (Ciclo 2a; até
 *    ali ela saía de `EVOLUTION_COMPANY_ID`, uma constante do deploy).
 *
 * É a 2, e a escolha não é só de conveniência: `claimLease` é a PRIMEIRA
 * operação do turno e é `$queryRaw`, que o escopo não alcança por construção.
 * O `WHERE "companyId"` dele é escrito à mão, e escrever à mão exige ter o
 * valor ANTES de tocar o banco. A saída 1 não tem como ter.
 *
 * O `companyId` do payload não é entrada de usuário: a rota consumidora
 * (`api/queues/whatsapp-turn/route.ts`) valida um segredo compartilhado antes
 * de chamar aqui, e quem publica é o nosso próprio webhook. E se ainda assim
 * ele vier errado, o sistema falha FECHADO: o `claimLease` escopado não
 * encontra a linha, devolve `null`, e o turno reagenda até desistir com log —
 * nenhuma leitura e nenhuma escrita na empresa errada.
 *
 * **Custo de migração, registrado porque ele é real:** jobs publicados ANTES
 * deste commit não carregam `companyId`. O `zod` da rota consumidora recusa o
 * payload, o handler lança, e a fila reentrega até esgotar. É perda de turno
 * (a mensagem do cliente continua gravada e visível em `/conversas`), barulhenta
 * e limitada à janela de deploy — o oposto de um `companyId` opcional, que
 * passaria calado e leria a empresa errada.
 */

// Fix round 1/5, achado CRÍTICO do revisor (C1): o valor original (25_000)
// já era menor que o próprio pior caso documentado aqui ("pode levar de 5 a
// 30s") — e pior, `llm/openai.ts` não tinha timeout nenhum configurado, então
// o SDK da OpenAI podia levar até 10 minutos (default) por chamada. Com
// `TIMEOUT_MS`/`MAX_RETRIES` agora limitando `OpenAiProvider` a ~40s de pior
// caso (20s * até 2 tentativas), 75s aqui cobre esse pior caso MAIS o tempo
// de envio via gateway (potencialmente várias mensagens) com folga real — e
// fica ACIMA de `maxDuration` (60s, api/queues/whatsapp-turn/route.ts): se a
// função for encerrada pela plataforma antes de rodar o `finally` que libera
// o lease, ele expira sozinho pouco depois em vez de ficar preso para
// sempre. O objetivo não é zero possibilidade de expiração (impossível sem
// lock distribuído de verdade), é tornar a expiração ORGÂNICA (sob operação
// normal) extremamente rara, para que o fencing token abaixo só precise
// lidar com o caso raro, não o comum.
const LEASE_DURACAO_MS = 75_000;

// Quantas mensagens de TEXTO anteriores (nos dois sentidos) entram no
// histórico passado ao modelo. Não é "todo o histórico da conversa desde o
// início" de propósito: cresceria sem limite o custo de cada chamada numa
// conversa longa, sem ganho proporcional de qualidade de resposta — 20 dá
// contexto suficiente para o tipo de troca curta que esta fatia atende
// (dúvida sobre veículo, agendamento), sem tentar ser memória de longo
// prazo (isso é problema de outra fatia, se algum dia importar).
const HISTORICO_MAX_MENSAGENS = 20;

// Fix round 1/5, achado do revisor (I5): `HISTORICO_MAX_MENSAGENS` limita a
// CONTAGEM de mensagens no contexto, não o TAMANHO de cada uma — uma única
// mensagem colada com dezenas de milhares de caracteres (nada impede um
// cliente de colar um texto enorme) entraria inteira no prompt, 20 vezes em
// potencial, inflando custo e tempo de resposta (o mesmo risco que motivou
// o timeout/max_tokens em llm/openai.ts, agora do lado da ENTRADA). Cada
// mensagem individual — tanto do histórico quanto do lote atual — é
// truncada antes de entrar no contexto.
const MAX_CARACTERES_POR_MENSAGEM_CONTEXTO = 2000;

// Fix round 1/5, achado CRÍTICO do revisor (C2): reagendar com
// `delaySeconds: 5` usando a MESMA `idempotencyKey` do job original
// (`${conversationId}:${seq}`) colidia com a janela de dedupe do Vercel
// Queues (até 24h) — `publicarTurno` lançava `DuplicateMessageError` em TODA
// ocorrência de lease ocupado, o handler 500ava, e quem de fato reentregava
// a mensagem era o retry padrão da fila (`retryAfterSeconds: 30` em
// vercel.json), não o reagendamento de 5s pretendido. `tentativaReagendamento`
// dá a cada republish uma `idempotencyKey` própria (ver fila.ts) — sem essa
// contagem, o job reagendado colidiria consigo mesmo na segunda vez também.
// Um teto evita reagendar para sempre se algo ficar genuinamente preso (ex.:
// uma conversa cujo lease nunca é liberado por um bug futuro) — 30 tentativas
// de 5s é ~2,5min de espera antes de desistir e logar, generoso o bastante
// para qualquer lease legítimo (no máximo `LEASE_DURACAO_MS`, hoje 75s)
// liberar no meio do caminho. (Este número dizia "60s" até a re-revisão da
// leva de fixes: era o valor de ANTES do C1 subir o lease, e ficou para trás
// quando a constante mudou — a margem continua confortável, mas um comentário
// que discorda da constante ao lado é justamente o que faz alguém recalibrar
// errado depois.)
const MAX_TENTATIVAS_REAGENDAMENTO = 30;

// Fix round 1/5, achado do revisor (I2): teto de respostas de IA por
// CONVERSA por hora — a proteção de custo real (rate limit por IP no
// webhook não protege isto, ver comentário em `processarMensagensPendentes`).
// 20 é generoso para qualquer troca legítima de uma revenda (mesmo uma
// negociação longa não chega a 20 idas e vindas numa hora), apertado o
// bastante para conter um cliente em loop (ou um número comprometido
// mandando mensagem em massa) de esgotar o orçamento de OpenAI sozinho. Um
// teto de GASTO mensal configurado no painel da OpenAI continua sendo o
// único backstop real contra um vazamento fora deste padrão — isso é
// configuração humana, não algo que este código possa impor.
const TETO_RESPOSTAS_IA_POR_HORA = 20;

const FALLBACK_MIDIA_NAO_SUPORTADA =
  "Por enquanto eu ainda não consigo processar áudio, imagem, figurinha ou documento — pode escrever em texto o que você precisa? Assim que possível, a equipe também vai poder ver essa mensagem.";

/**
 * Processa um turno de conversa: reivindica o lease, confere se a mensagem
 * que disparou este job ainda é a mais recente (`seq` vs. `bufferSeq`),
 * junta as mensagens ENTRADA ainda não respondidas, gera e envia a
 * resposta, marca tudo como processado e libera o lease.
 *
 * ## Lease (exclusão mútua por conversa) — com fencing token (fix round 1/5)
 *
 * `claimLease` faz UM UPDATE condicional atômico — mesmo idioma de
 * `checarRateLimit` (core/rate-limit/limiter.ts) — e devolve o valor exato
 * de `processandoAte` que ele mesmo escreveu: esse valor É o "fencing
 * token" desta reivindicação. `liberarLease` só apaga o lease quando
 * `processandoAte` no banco AINDA é esse mesmo valor
 * (`WHERE ... AND "processandoAte" = $token`) — sem isso (achado CRÍTICO do
 * revisor, C1), um processador A que demora além do próprio lease (relógio
 * derrapou, GC pausou, rede lenta — não hipotético: o SDK da OpenAI sem
 * timeout já causava isso) e só termina DEPOIS que um processador B
 * reivindicou a MESMA conversa (porque o lease de A expirou nesse meio
 * tempo) apagaria, ao terminar, o lease que B está ativamente usando —
 * abrindo a porta para um TERCEIRO processador C entrar enquanto B ainda
 * trabalha, e assim por diante, sem limite superior de quantos processadores
 * concorrentes acabam empilhados na mesma conversa. Com o fencing token, o
 * `UPDATE` de A vira um no-op assim que A está "desatualizado" — o lease
 * nunca tem mais de UM dono ativo por vez, mesmo quando a expiração
 * acontece de verdade.
 *
 * Quando a reivindicação falha (0 linhas afetadas — lease genuinamente
 * ocupado), reagenda o MESMO job com `delaySeconds: 5` — mas com uma
 * `idempotencyKey` NOVA a cada tentativa (ver `MAX_TENTATIVAS_REAGENDAMENTO`
 * acima e `fila.ts`), não descarta a mensagem: outro processo pode estar
 * processando um turno anterior da mesma conversa, e este job ainda precisa
 * rodar depois.
 *
 * ## Buffer (fragmentos viram uma resposta só)
 *
 * `claimLease` também devolve o `bufferSeq` ATUAL da conversa (lido na
 * mesma instrução que reivindica o lease). Se ele for diferente do `seq`
 * que este job carrega, uma mensagem mais nova já chegou desde que este job
 * foi publicado — o job da mensagem mais nova (publicado com seu próprio
 * delay de 8s a partir de QUANDO ELA chegou) vai, quando disparar, ver
 * `bufferSeq` igual ao seu próprio `seq` e processar TODAS as mensagens
 * ainda não respondidas (`processadoEm: null`) de uma vez — inclusive as
 * que os jobs anteriores, descartados por esta checagem, não processaram.
 * É esse mecanismo, não um "espera X segundos e junta", que faz três
 * mensagens fragmentadas virarem uma resposta só.
 */
export async function processarTurno(job: TurnoJob): Promise<void> {
  const db = prismaDaEmpresa(job.companyId);
  const lease = await claimLease(job.companyId, job.conversationId);
  if (!lease) {
    const tentativa = (job.tentativaReagendamento ?? 0) + 1;
    if (tentativa > MAX_TENTATIVAS_REAGENDAMENTO) {
      console.error(
        `Turno da conversa ${job.conversationId} (seq ${job.seq}) desistiu depois de ` +
          `${MAX_TENTATIVAS_REAGENDAMENTO} tentativas de lease ocupado — algo está retendo o lease por ` +
          `tempo desproporcional.`
      );
      return;
    }
    try {
      await publicarTurno({ ...job, tentativaReagendamento: tentativa }, { delaySeconds: 5 });
    } catch (erro) {
      // Re-revisão da leva de fixes: entrega "pelo menos uma vez" significa
      // que a fila pode reentregar o MESMO job (mesmo `seq`, mesma
      // `tentativaReagendamento`) quando a confirmação de um handler que já
      // rodou com sucesso se perde. Nesse caso o reagendamento desta
      // tentativa JÁ foi publicado, sua `idempotencyKey` já está na janela de
      // dedupe, e `send()` recusa a republicação.
      //
      // Sem este catch o erro sobe, o handler responde 500, a fila reentrega
      // e o ciclo se repete até esgotar as tentativas de entrega — a MESMA
      // classe do achado C2, só que disparada por um caminho raro em vez de
      // sempre. E é um alarme falso: o job reagendado correto já está na fila
      // fazendo o trabalho, então "já existe" é exatamente o resultado
      // desejado, não uma falha. Mesmo tratamento que a rota do webhook já dá
      // a este erro (`api/whatsapp/evolution/[companyId]/[token]/route.ts`).
      if (erro instanceof DuplicateMessageError) return;
      throw erro;
    }
    return;
  }

  try {
    if (lease.bufferSeq !== job.seq) {
      // Mensagem mais nova já chegou — o turno dela (ou um turno seguinte
      // que também vier a bater) cuida de responder tudo que está pendente.
      return;
    }

    await processarMensagensPendentes(db, job.companyId, job.conversationId, lease.processandoAte);
  } finally {
    await liberarLease(job.companyId, job.conversationId, lease.processandoAte);
  }
}

async function processarMensagensPendentes(
  db: ClienteDaEmpresa,
  companyId: string,
  conversationId: string,
  meuToken: Date
): Promise<void> {
  const pendentes = await db.whatsappMessage.findMany({
    where: { conversationId, direcao: "ENTRADA", processadoEm: null },
    orderBy: { criadoEm: "asc" },
  });

  if (pendentes.length === 0) return;

  // Fatia 2: a guarda fica AQUI, não no webhook. A mensagem do cliente
  // continua sendo ingerida e aparece na inbox mesmo com a IA calada — barrar
  // no webhook faria a mensagem sumir, que é o pior comportamento possível
  // numa conversa sob atendimento humano.
  //
  // Mesmo tratamento que o teto de respostas por hora logo abaixo: as
  // pendentes são marcadas como processadas SEM resposta ("persiste mas para
  // de responder", nunca "descarta calado").
  //
  // `conversaAtual` vem ANTES de `configBot`, e não por acaso: `BotConfig`
  // deixou de ter id constante (Task 1 do Ciclo 1a — uma linha por empresa,
  // `@@unique([companyId])`) e `BOT_CONFIG_ID` ("bot-config") não é mais um id
  // válido para buscar em runtime — `findUnique({ where: { id: BOT_CONFIG_ID
  // } })` continuava COMPILANDO e passava a devolver `null` sempre, o tipo de
  // bug que o compilador não pega (ver `config/bot.ts`). A `Conversation` já
  // está em mãos aqui — é a origem da empresa, e a busca de `BotConfig` passa
  // a ser por `companyId`.
  // `findFirstOrThrow` nas duas: o escopo recusa `findUniqueOrThrow` em modelo
  // de tenant. Em `BotConfig` a troca é maior que sintaxe — `@@unique([companyId])`
  // faria `findUnique({ where: { companyId } })` funcionar, e o escopo recusa
  // mesmo assim, por uniformidade (o porquê está em `core/tenancy/escopo.ts`,
  // bloco "Recusa, lançando"). O `where` some inteiro: a empresa entra pelo
  // cliente, e `BotConfig` tem uma linha por empresa.
  const conversaAtual = await db.conversation.findFirstOrThrow({
    where: { id: conversationId },
    select: { iaAtiva: true, companyId: true },
  });
  const configBot = await db.botConfig.findFirstOrThrow({});

  if (!configBot.ativo || !conversaAtual.iaAtiva) {
    const motivo = !configBot.ativo ? "interruptor global desligado" : "IA pausada nesta conversa";
    console.info(`Conversa ${conversationId}: ${motivo} — pendentes marcadas sem resposta automática.`);
    await marcarPendentesComoProcessadas(db, pendentes);
    // Depois de marcar as pendentes, não antes: se isto lançasse primeiro, o
    // turno lançaria e o job seria reentregue com a conversa já sinalizada
    // por um trabalho que não terminou (ver docstring de
    // `marcarPendentesComoProcessadas` para os quatro pontos irmãos deste).
    await marcarAguardandoHumano(companyId, conversationId);
    return;
  }

  // Fix round 1/5, achado do revisor (I2): o rate limit do webhook é por
  // IP — e todo tráfego legítimo vem de UM IP (a instância Evolution), então
  // aquele limite nunca protege CUSTO por cliente: N números de telefone
  // diferentes são N conversas independentes, cada uma com seu próprio
  // lease, todas bem dentro do orçamento de um único IP. Este é o teto que
  // protege a dimensão que importa — conversas por vez, não requisições por
  // IP. Ultrapassado o teto, as pendentes são marcadas como processadas
  // (persistidas, visíveis no inbox humano em `/conversas`) mas SEM resposta
  // automática — "persiste mas para de responder", não "descarta calado":
  // um humano que abrir a conversa no painel vê as mensagens do cliente
  // esperando, mesmo sem a IA ter respondido.
  if (await respostasIaNaUltimaHoraAtingiuTeto(db, conversationId)) {
    console.warn(
      `Conversa ${conversationId} atingiu o teto de ${TETO_RESPOSTAS_IA_POR_HORA} respostas de IA na ` +
        `última hora — pendentes marcadas como processadas sem resposta automática.`
    );
    await marcarPendentesComoProcessadas(db, pendentes);
    await marcarAguardandoHumano(companyId, conversationId);
    return;
  }

  const comTexto = pendentes.filter(
    (mensagem) => mensagem.tipo === "TEXTO" && mensagem.texto && mensagem.texto.trim().length > 0
  );
  const semTexto = pendentes.filter((mensagem) => mensagem.tipo !== "TEXTO");

  let respostas: string[];
  if (comTexto.length === 0) {
    // Nenhuma mensagem pendente tem texto utilizável (só áudio/imagem/
    // figurinha/documento) — fora de escopo desta fatia, resposta de
    // fallback única, sem chamar o modelo.
    respostas = [FALLBACK_MIDIA_NAO_SUPORTADA];
  } else {
    const historicoAnterior = await buscarHistorico(db, conversationId, pendentes[0]!.criadoEm);
    // Fragmentos de texto pendentes são unidos numa única mensagem "CLIENTE"
    // no contexto — é literalmente o comportamento que o plano da Fatia 1
    // pede: "as mensagens fragmentadas juntadas numa resposta só". Cada
    // fragmento é truncado INDIVIDUALMENTE antes de entrar no join (fix
    // round 1/5, I5) — truncar a string já unida deixaria fragmentos
    // depois do primeiro muito longo cortarem informação no meio sem
    // critério algum.
    const textoUnido = comTexto.map((mensagem) => truncarParaContexto(mensagem.texto!)).join("\n");

    const resultado = await llmProvider.gerarResposta({
      systemPrompt: montarPromptSistema(configBot),
      historico: [...historicoAnterior, { autor: "CLIENTE", texto: textoUnido }],
    });

    respostas =
      semTexto.length > 0 ? [...resultado.mensagens, FALLBACK_MIDIA_NAO_SUPORTADA] : resultado.mensagens;
  }

  // Fix round 1/5 (extensão do fencing token de C1, além da liberação):
  // depois da chamada ao modelo — de longe o trecho mais demorado deste
  // turno — confirmamos que AINDA somos o titular do lease antes de fazer
  // qualquer coisa visível ao cliente (enviar mensagem). No cenário exato
  // que o revisor reproduziu (lease expira DE VERDADE enquanto uma chamada
  // lenta ao modelo está em voo, um segundo processador reivindica e conclui
  // o turno inteiro antes do primeiro terminar), isto é o que impede o
  // primeiro processador — que só descobre isso DEPOIS de já ter pago o
  // custo da chamada ao modelo, não há como cancelar uma requisição HTTP já
  // em voo — de mandar uma SEGUNDA resposta ao cliente. `liberarLease` (no
  // `finally` de `processarTurno`) continua sendo a segunda camada: mesmo
  // que este check e o envio corram entre si de alguma forma, o release só
  // afeta a linha se o token ainda bater.
  const motivoAborto = await confirmarTitularidadeLease(companyId, conversationId, meuToken);
  if (motivoAborto === "lease-perdido") {
    console.warn(
      `Turno da conversa ${conversationId} abortado antes de enviar: outro processador assumiu o ` +
        `lease enquanto este aguardava o modelo. Resposta gerada descartada para não duplicar envio.`
    );
    return;
  }
  if (motivoAborto === "ia-pausada") {
    console.info(
      `Turno da conversa ${conversationId} abortado antes de enviar: um humano assumiu a conversa ` +
        `enquanto o modelo respondia. Resposta gerada descartada.`
    );
    await marcarPendentesComoProcessadas(db, pendentes);
    await marcarAguardandoHumano(companyId, conversationId);
    return;
  }

  const conversation = await db.conversation.findFirstOrThrow({ where: { id: conversationId } });

  // ## De onde sai a conexão do envio (Ciclo 2a, Tarefa 8)
  //
  // Era `whatsappGateway`, um singleton por PROCESSO com a credencial de
  // `EVOLUTION_*`. Ele morava em `gateway/index.ts` e foi apagado de lá pela
  // Tarefa 10, junto com as variáveis. Um processo serve várias empresas, e
  // uma empresa pode ter mais de uma conexão (decisão travada 4 do
  // `CLAUDE.md`): com credencial por empresa, aquele singleton responderia o
  // cliente da empresa B pela instância da A.
  //
  // Resolvido UMA vez por turno, fora do laço: a conexão não muda no meio de
  // um turno, e resolver dentro faria uma consulta ao banco e uma decifragem
  // AES-GCM por mensagem enviada sem nada em troca. Tem caso de teste
  // contando as chamadas ("resolve o gateway UMA vez por turno").
  //
  // `conversation` vem do `findFirstOrThrow` acima SEM `select`, então
  // `connectionId` está em mãos. Se ele for nulo (conversa anterior ao Ciclo
  // 2a — não houve backfill, decisão registrada na Tarefa 1), a fábrica cai
  // em `credencialAtivaUnica` e RECUSA se houver mais de uma ativa:
  // responder pelo número errado é pior que não responder.
  const gateway = await gatewayDaConversa(companyId, conversation);

  // Fix round 1/5, achado do revisor (I4): antes, `pendentes` só era marcado
  // `processadoEm` depois que TODAS as `respostas` terminavam de enviar. Se
  // o envio da 2ª (ou 3ª) mensagem falhasse, o handler lançava com NENHUMA
  // pendente marcada — a fila reentregava o job (retry padrão, 30s), o
  // modelo era chamado de novo com a MESMA entrada, e o cliente recebia a
  // 1ª mensagem (que já tinha ido) DE NOVO, mais o resto. Marcar as
  // pendentes assim que a PRIMEIRA resposta é confirmada enviada — não
  // depois de todas — faz o pior caso de uma falha parcial ser "o cliente
  // não recebeu a 2ª/3ª mensagem deste turno" em vez de "o cliente recebeu a
  // 1ª mensagem duplicada". Perder uma mensagem é recuperável (o cliente
  // reage à falta de resposta, manda outra mensagem, um novo turno roda);
  // duplicar não é.
  let pendentesMarcadas = false;
  for (const texto of respostas) {
    const envio = await gateway.enviarTexto(conversation.waId, texto);
    // `WhatsappMessage.companyId` é `NOT NULL` desde a Task 1. `conversation`
    // já está em mãos, linha inteira (sem `select` no fetch acima) — usa o
    // `companyId` dela, sem sessão nenhuma envolvida.
    await db.whatsappMessage.create({
      data: {
        companyId: conversation.companyId,
        conversationId,
        idExterno: envio.idExterno,
        direcao: "SAIDA",
        autor: "IA",
        tipo: "TEXTO",
        texto,
        processadoEm: new Date(),
      },
    });

    if (!pendentesMarcadas) {
      await marcarPendentesComoProcessadas(db, pendentes);
      // A IA falou com o cliente — ninguém está mais esperando um humano.
      // Depois de marcar as pendentes, mesmo raciocínio dos outros três
      // pontos: nunca sinalizar (aqui, limpar) antes do trabalho concluir.
      await limparAguardandoHumano(companyId, conversationId);
      pendentesMarcadas = true;
    }
  }
}

/**
 * Marca um lote de mensagens ENTRADA como processadas SEM que uma resposta
 * automática tenha sido enviada — usado nos QUATRO pontos onde as pendentes
 * precisam ficar visíveis no inbox humano mesmo sem resposta da IA (revisão
 * final da fatia: o docstring dizia "três pontos" e listava três, mas já
 * havia um quarto call site desde que `MotivoAborto` existe):
 *
 * 1. A guarda de IA pausada/interruptor desligado, ANTES de chamar o modelo.
 * 2. O teto de respostas por hora.
 * 3. O aborto por `motivoAborto === "ia-pausada"` DEPOIS da chamada ao
 *    modelo (um humano assumiu a conversa enquanto o modelo pensava) — o
 *    caso que motivou o tipo `MotivoAborto` existir, ver o comentário dele.
 * 4. O envio normal (chamado aqui de novo, com o mesmo formato, para não
 *    duplicar a query em quatro lugares).
 *
 * Fatia 3 (aviso de conversa aguardando humano): os pontos 1-3 são "processou
 * sem responder" — cada um é seguido de `marcarAguardandoHumano`, sempre
 * DEPOIS desta chamada (se ela falhar, o turno lança e o job é reentregue; a
 * conversa não pode ficar sinalizada por um trabalho que não terminou). O
 * ponto 4 é o envio bem-sucedido da IA — seguido de `limparAguardandoHumano`,
 * não de `marcarAguardandoHumano`: marcar aqui encheria o sino de conversas
 * que a IA está atendendo normalmente, e a equipe pararia de olhar o sino.
 */
async function marcarPendentesComoProcessadas(
  db: ClienteDaEmpresa,
  pendentes: Array<{ id: string }>
): Promise<void> {
  await db.whatsappMessage.updateMany({
    where: { id: { in: pendentes.map((mensagem) => mensagem.id) } },
    data: { processadoEm: new Date() },
  });
}

async function respostasIaNaUltimaHoraAtingiuTeto(
  db: ClienteDaEmpresa,
  conversationId: string
): Promise<boolean> {
  const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);
  const contagem = await db.whatsappMessage.count({
    where: { conversationId, direcao: "SAIDA", autor: "IA", criadoEm: { gte: umaHoraAtras } },
  });
  return contagem >= TETO_RESPOSTAS_IA_POR_HORA;
}

function truncarParaContexto(texto: string): string {
  if (texto.length <= MAX_CARACTERES_POR_MENSAGEM_CONTEXTO) return texto;
  return `${texto.slice(0, MAX_CARACTERES_POR_MENSAGEM_CONTEXTO)} […mensagem truncada]`;
}

/**
 * Motivo pelo qual o turno deve abortar antes de enviar — `null` quando pode
 * seguir.
 *
 * Os dois motivos NÃO recebem o mesmo tratamento, e é por isso que isto
 * deixou de ser um booleano na Fatia 2:
 *
 * - `lease-perdido`: outro processador assumiu a conversa e vai responder as
 *   pendentes. Marcá-las aqui as faria sumir sem resposta nenhuma.
 * - `ia-pausada`: um humano assumiu enquanto o modelo pensava. Não há
 *   resposta automática a dar, então as pendentes SÃO marcadas — mesmo
 *   tratamento do teto por hora.
 *
 * Com um booleano só, um dos dois casos fica necessariamente errado.
 */
export type MotivoAborto = "lease-perdido" | "ia-pausada" | null;

/**
 * Confere se `token` ainda é o valor de `processandoAte` gravado agora, e se
 * a IA continua ativa nesta conversa — usado depois da chamada (lenta) ao
 * modelo, antes de enviar qualquer mensagem (ver comentário em
 * `processarMensagensPendentes`). Exportada (junto com
 * `claimLease`/`liberarLease` abaixo) para `tests/unit/whatsapp-turno.test.ts`
 * poder provar o mecanismo do fencing token diretamente, sem depender de
 * temporização real entre chamadas concorrentes a `processarTurno`.
 */
export async function confirmarTitularidadeLease(
  companyId: string,
  conversationId: string,
  token: Date
): Promise<MotivoAborto> {
  // `findFirst` e não `findUnique`: recusado pelo escopo em modelo de tenant.
  // O `null` que a busca pode devolver já era tratado (`?.`), e agora ele cobre
  // um caso a mais — conversa de outra empresa —, com o mesmo desfecho:
  // "lease-perdido", que aborta antes de enviar qualquer coisa ao cliente.
  const conversation = await prismaDaEmpresa(companyId).conversation.findFirst({
    where: { id: conversationId },
    select: { processandoAte: true, iaAtiva: true },
  });

  if (conversation?.processandoAte?.getTime() !== token.getTime()) return "lease-perdido";
  if (!conversation.iaAtiva) return "ia-pausada";
  return null;
}

/**
 * Reivindica o lease com um UPDATE condicional atômico e devolve o
 * `processandoAte` (fencing token) que ele mesmo escreveu — `null` quando a
 * reivindicação falha (lease genuinamente ocupado por outro processador).
 */
export async function claimLease(
  companyId: string,
  conversationId: string
): Promise<{ bufferSeq: number; processandoAte: Date } | null> {
  const agora = new Date();
  const ateLease = new Date(agora.getTime() + LEASE_DURACAO_MS);

  // `WHERE "companyId"` escrito À MÃO, e a redundância é APARENTE: o cliente é
  // escopado, mas `$queryRaw` NÃO passa por `$allModels` — o escopo não o
  // alcança por construção (`core/tenancy/escopo.ts`, "Não alcança de jeito
  // nenhum"). Este é o ponto mais fácil de errar do módulo, porque `db` está
  // ali do lado e parece cobrir tudo.
  //
  // Quem cobra é a Parte 2b de `tests/unit/catraca-prisma-cru.test.ts`: ela lê
  // o TEXTO do template de todo `$queryRaw`/`$executeRaw` de arquivo já
  // convertido, e reprova o que citar tabela de tenant sem `companyId`. Passou
  // a valer para este arquivo no instante em que ele saiu da fila.
  const linhas = await prismaDaEmpresa(companyId).$queryRaw<
    Array<{ bufferSeq: number; processandoAte: Date }>
  >`
    UPDATE "Conversation"
    SET "processandoAte" = ${ateLease}::timestamp(3)
    WHERE "id" = ${conversationId}
      AND "companyId" = ${companyId}
      AND ("processandoAte" IS NULL OR "processandoAte" < ${agora}::timestamp(3))
    RETURNING "bufferSeq", "processandoAte"
  `;

  return linhas[0] ?? null;
}

/**
 * Libera o lease SOMENTE se `processandoAte` no banco ainda for exatamente o
 * `token` que esta chamada reivindicou (fencing token — ver o comentário
 * grande em `processarTurno`). Quando o lease já foi expirado e reivindicado
 * por outro processador, este UPDATE afeta 0 linhas — de propósito: liberar
 * o lease de outro processador seria exatamente o bug que este fix corrige.
 */
export async function liberarLease(
  companyId: string,
  conversationId: string,
  token: Date
): Promise<void> {
  // `companyId` à mão pelo mesmo motivo de `claimLease` — ver lá.
  await prismaDaEmpresa(companyId).$executeRaw`
    UPDATE "Conversation"
    SET "processandoAte" = NULL
    WHERE "id" = ${conversationId}
      AND "companyId" = ${companyId}
      AND "processandoAte" = ${token}::timestamp(3)
  `;
}

async function buscarHistorico(
  db: ClienteDaEmpresa,
  conversationId: string,
  antesDe: Date
): Promise<Array<{ autor: AutorMensagemContexto; texto: string }>> {
  const mensagens = await db.whatsappMessage.findMany({
    where: {
      conversationId,
      tipo: "TEXTO",
      texto: { not: null },
      // Estritamente ANTERIOR ao primeiro fragmento pendente deste turno —
      // não só diferente de um id (fix: com 2+ fragmentos pendentes,
      // excluir só o primeiro por id deixava os fragmentos SEGUINTES
      // aparecerem aqui E de novo no texto unido de `comTexto`, duplicando
      // conteúdo no contexto passado ao modelo). Todo fragmento deste turno
      // tem `criadoEm >= antesDe` (o próprio `pendentes[0]`, que é o mais
      // antigo do lote, define o corte) — este filtro exclui todos eles de
      // uma vez, sem precisar saber os ids individuais.
      criadoEm: { lt: antesDe },
    },
    orderBy: { criadoEm: "desc" },
    take: HISTORICO_MAX_MENSAGENS,
  });

  return mensagens
    .reverse()
    .map((mensagem) => ({ autor: mensagem.autor, texto: truncarParaContexto(mensagem.texto ?? "") }));
}
