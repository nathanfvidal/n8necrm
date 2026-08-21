// `import "server-only"` — mesmo padrão de `src/lib/prisma.ts`,
// `src/core/leads/notes.ts` e `src/core/tasks/service.ts`: este módulo
// importa Prisma diretamente. Sem esta linha, o único motivo pelo qual um
// Client Component não conseguiria importar isto seria coincidência do
// bundler, não uma garantia.
import "server-only";

import { after } from "next/server";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { enviarEmailMelhorEsforco } from "./email-envio";
import { NovoLeadEmail } from "./email";
import type { NovoLeadPayload } from "./types";
import type { Notification } from "@prisma/client";

/**
 * Notifica o responsável por um lead recém-criado: grava uma notificação
 * in-app (sempre) e, quando o Resend está configurado, tenta também enviar
 * um e-mail (melhor esforço).
 *
 * Chamada por `criarLead` (`leads/service.ts`) depois que o lead e a
 * auditoria já estão persistidos — ver o comentário lá sobre por que a
 * chamada inteira é envolvida num `try/catch` que nunca deixa uma falha
 * de notificação derrubar a criação do lead (spec seção 6: "falha de
 * módulo secundário nunca derruba o principal").
 *
 * Dentro desta função, a notificação in-app e o e-mail têm tratamento de
 * erro DIFERENTE, de propósito:
 * - A gravação da notificação in-app (`prisma.notification.create`) NÃO é
 *   envolvida em try/catch aqui — se o banco estiver fora do ar, é um erro
 *   real que deve propagar (o `try/catch` de `criarLead` do lado de fora é
 *   quem decide não deixar isso quebrar a criação do lead; aqui dentro não
 *   faz sentido fingir sucesso).
 * - O envio de e-mail é MELHOR ESFORÇO, e SEMPRE roda depois da notificação
 *   in-app já estar gravada: um Resend fora do ar (ou, no caso comum deste
 *   projeto, a chave que não existe) nunca deveria impedir a pessoa de ver a
 *   notificação dentro do próprio CRM. O try/catch e o `resend === null`
 *   moram em `./email-envio.ts` desde o reparo do achado 40 — é o pedaço que
 *   o alerta de rajada (`core/audit/alerta.ts`) passou a compartilhar, e a
 *   regra de resiliência está escrita lá, uma vez só, para os dois caminhos.
 */
export async function notificarNovoLead(companyId: string, leadId: string): Promise<void> {
  const db = prismaDaEmpresa(companyId);

  // `findFirstOrThrow` e não `findUniqueOrThrow`: a segunda é recusada pelo
  // escopo, porque o `where` dela só aceita campo único e `companyId` não é
  // único em `Lead` (ver "Recusa, lançando" em `core/tenancy/escopo.ts`). O
  // efeito prático é o desejado: um `leadId` de outra empresa deixa de devolver
  // a linha e passa a lançar `NotFoundError` — a MESMA resposta de um id
  // inexistente.
  const lead = await db.lead.findFirstOrThrow({
    where: { id: leadId },
    // `select` explícito, e NUNCA `include: { ... responsavel: true }`.
    //
    // Esta consulta era `include: { contact: true, stage: true, responsavel: true }`,
    // e cada um dos três trazia coisa que este arquivo não usa:
    //
    // - `responsavel: true` carregava a linha inteira de `User` — `senhaHash`
    //   junto — para ler `id` e `email`. Mesma correção que `leads/queries.ts`
    //   e `tasks/queries.ts` já tinham recebido; esta ficou para trás porque
    //   ninguém varreu o módulo de notificações na época.
    // - `contact: true` carregava a linha inteira de `Contact` para ler
    //   `nome`. Quando essa linha foi escrita, `Contact` era nome, telefone e
    //   e-mail e o excesso parecia inofensivo. Hoje ela guarda `documento`
    //   (CPF/CNPJ), `endereco` e `observacoes` — a consulta piorou sozinha,
    //   sem ninguém tocar nela, que é exatamente o que uma consulta curinga
    //   faz quando a tabela cresce.
    // - `stage: true` carregava a etapa inteira para ler `nome`.
    //
    // Nada disso vazava para um cliente: este módulo é `server-only`, e o
    // payload gravado em `Notification` é só `{ leadId, contatoNome }`. O que
    // se corrige aqui é o raio de explosão — o objeto existe em memória, e
    // um `console.error` ou um relatório de exceção que serialize o contexto
    // leva junto o que ele carrega. Buscar o que não se usa é a dívida que
    // vira vazamento no dia em que alguém passa o objeto um nível adiante.
    select: {
      id: true,
      companyId: true,
      contact: { select: { nome: true } },
      stage: { select: { nome: true } },
      responsavel: { select: { id: true, email: true } },
    },
  });

  // Lead sem responsável atribuído: nada a notificar (ninguém para
  // notificar) e nenhum e-mail a enviar. `criarLead` (service.ts) sempre
  // exige `responsavelId`, então este ramo não é alcançado pelo fluxo
  // principal hoje — mas `Lead.responsavelId` é opcional no schema, e
  // outros caminhos de escrita (um script administrativo futuro, uma
  // importação em massa) podem criar leads sem responsável.
  if (!lead.responsavel) return;

  const payload: NovoLeadPayload = {
    leadId: lead.id,
    contatoNome: lead.contact?.nome ?? "Sem contato identificado",
  };

  // `Notification.companyId` é `NOT NULL` desde a Task 1 do Ciclo 1a. `lead`
  // já está em mãos (`select` acima) — é a origem preferida das três (registro
  // já carregado), sem consulta extra nenhuma.
  //
  // ## A invariante que estas duas linhas assumem, e QUEM a garante
  //
  // `companyId` e `userId` saem de origens DIFERENTES — a empresa do lead e o
  // responsável do lead — e nada aqui confere que batem. Uma `Notification`
  // com `companyId` da empresa A e `userId` de alguém da B é expressável neste
  // `create`, e seria exatamente o vazamento: a pessoa de fora recebe aviso
  // in-app (e e-mail, logo abaixo) sobre o cliente de um terceiro.
  //
  // Elas batem porque `src/core/leads/service.ts` **exige `Membership` na
  // empresa do lead** antes de gravar `Lead.responsavelId` — a função é
  // `responsavelDaEmpresa`, e os três pontos que atribuem responsável
  // (`criarLead`, `atualizarLead`, `criarLeadDeWhatsapp`) passam por ela
  // desde o commit 6dfb325 (Ciclo 1a, Task 4, achado B). Antes disso a
  // validação conferia só que o usuário EXISTIA, e este `create` gravava a
  // divergência sem reclamar.
  //
  // Medido em 2026-08-20: `Lead.responsavelId` só é escrito em
  // `src/core/leads/service.ts` (3 pontos) e nos dois seeds
  // (`prisma/seed.ts:187`, `prisma/seed-demo.ts:359`), que criam responsável e
  // lead na mesma empresa. `excluirEtapa` (`src/core/pipeline/service.ts`) toca
  // `Lead` mas só o `stageId` — e, desde a conversão daquele módulo (Ciclo 1d),
  // por um `updateMany` escopado. A citação era por NÚMERO de linha e virou por
  // NOME de função de propósito: número de linha envelhece na primeira edição
  // do arquivo citado, e foi o que aconteceu.
  //
  // **Se um import em massa, um script ou um módulo novo passar a escrever
  // `Lead.responsavelId`, ele herda essa obrigação** — ou este ponto volta a
  // vazar em silêncio, sem erro de tipo e sem teste vermelho aqui. O caso que
  // trava a regressão é "a notificação do lead criado fica na empresa do lead"
  // (`tests/unit/lead-isolamento.test.ts`), e ele exerce o caminho de
  // `criarLead` — não os caminhos que ainda não existem.
  await db.notification.create({
    data: {
      companyId: lead.companyId,
      userId: lead.responsavel.id,
      tipo: "NOVO_LEAD",
      payload,
    },
  });

  await enviarEmailMelhorEsforco({
    para: lead.responsavel.email,
    assunto: "Novo lead recebido",
    react: NovoLeadEmail({
      contatoNome: payload.contatoNome,
      etapaNome: lead.stage.nome,
    }),
    contexto: "notificação de novo lead",
  });
}

/**
 * Lista as notificações não lidas de um usuário, mais recente primeiro.
 * Escopada por `userId` E por empresa, e o "e" é o ponto: escopo por DONO não é
 * escopo por EMPRESA. Enquanto ninguém tem vínculo em duas empresas os dois
 * coincidem — toda notificação minha é da minha empresa —, e é por isso que
 * `userId` sozinho parecia bastar. Com dois vínculos o sino misturaria os avisos
 * das duas: o rótulo do cliente de uma empresa (`payload.nomeExibicao`, ver
 * `modules/whatsapp/notificacoes.ts`) apareceria numa sessão da outra.
 *
 * `userId` continua vindo do usuário da sessão atual (o sino,
 * `notification-bell.tsx`, via layout do painel), nunca de um id arbitrário do
 * cliente — e `companyId` vem da mesma sessão.
 */
export async function listarNotificacoesNaoLidas(
  companyId: string,
  userId: string
): Promise<Notification[]> {
  const naoLidas = await prismaDaEmpresa(companyId).notification.findMany({
    where: { userId, lidaEm: null },
    orderBy: { criadoEm: "desc" },
  });

  agendarPoda(companyId);

  return naoLidas;
}

/**
 * Manda a poda para DEPOIS da resposta, em vez de esperá-la aqui.
 *
 * O comentário que morava aqui dizia que a higiene vem "depois da leitura,
 * nunca antes: a poda não pode atrasar nem influenciar o que o sino mostra".
 * Influenciar ela nunca influenciou; **atrasar, atrasava** — era um
 * `await podarDeVezEmQuando()` no caminho crítico do layout do painel, ou
 * seja, no meio de todo carregamento completo de toda tela. Nas vezes em que
 * o sorteio dá poda, é um `DELETE` inteiro de espera antes de a página
 * começar a existir, e o banco está em `sa-east-1` (85 ms de mediana por
 * viagem, medido na Tarefa 0).
 *
 * `after()` roda o callback depois de a resposta terminar
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md),
 * que é literalmente o desenho que aquele comentário já descrevia.
 *
 * ## Por que o `try`, e o que ele NÃO é
 *
 * A primeira versão deste comentário afirmava que `after()` lança fora de
 * contexto de requisição e que sem o `try` os testes de unidade quebrariam.
 * **Isso não foi verificado, e é falso.** Medido: com o filtro do `catch`
 * trocado por um padrão que nunca casa, `tests/unit/notifications.test.ts`
 * (que chama `listarNotificacoesNaoLidas` direto, sob Vitest, sem requisição
 * nenhuma) roda 6/6 sem imprimir uma linha sequer — `after()` simplesmente
 * não lança ali.
 *
 * O `try` fica, mas como seguro, não como necessidade conhecida: se algum
 * runtime futuro passar a lançar, o sino de notificações não pode cair junto.
 * E o `catch` REGISTRA, em vez de engolir — um `catch` vazio faria a poda
 * sumir sem ninguém notar, e `Notification` voltaria a crescer sem teto em
 * silêncio. Como hoje nenhum caminho conhecido lança, qualquer linha que
 * apareça neste log é surpresa de verdade, e merece ser lida.
 *
 * Perder a poda numa chamada é aceitável: ela é oportunista por construção
 * (roda por sorteio, ver `CHANCE_DE_PODA`), o próximo carregamento do painel
 * volta a sorteá-la, e `podarNotificacoes` tem testes que a exercitam
 * diretamente (`tests/unit/notificacoes-poda.test.ts`).
 */
function agendarPoda(companyId: string): void {
  try {
    after(() => podarDeVezEmQuando(companyId));
  } catch (erro) {
    console.error("Falha ao agendar a poda de notificações:", erro);
  }
}

/**
 * Por quanto tempo uma notificação LIDA é mantida.
 *
 * Já cumpriu a função — alguém viu. Trinta dias deixam margem para alguém
 * querer reler algo recente sem manter histórico que ninguém consulta.
 */
export const RETENCAO_LIDA_MS = 30 * 24 * 60 * 60_000;

/**
 * Teto absoluto, independente de leitura.
 *
 * Existe por causa de quem nunca abre o sino: sem ele, a proteção de "não
 * apagar o que não foi lido" reabriria o crescimento sem teto que esta poda
 * veio fechar. Um aviso de meio ano que ninguém abriu não é trabalho
 * pendente, é entulho.
 */
export const RETENCAO_ABSOLUTA_MS = 180 * 24 * 60 * 60_000;

/**
 * Apaga notificações que já não servem a ninguém. Devolve quantas saíram.
 *
 * Risco corrigido (auditoria): nada nunca apagava linha desta tabela. Cada
 * lead novo gera uma para o responsável; cada conversa que passa a aguardar
 * humano gera UMA POR USUÁRIO ATIVO (`modules/whatsapp/notificacoes.ts`); e o
 * alerta de rajada destrutiva (`core/audit/alerta.ts`) soma outra por ADMIN.
 * O crescimento é proporcional ao tamanho da equipe e não parava nunca.
 *
 * Duas janelas, e a distinção entre elas é a regra que protege o usuário:
 * aviso NÃO LIDO é trabalho pendente e sobrevive à primeira janela por mais
 * velho que esteja — apagá-lo por idade seria a limpeza escondendo justamente
 * o que o sino existe para mostrar. A segunda janela é o limite dessa
 * proteção.
 */
export async function podarNotificacoes(
  companyId: string,
  opcoes?: {
    retencaoLidaMs?: number;
    retencaoAbsolutaMs?: number;
  }
): Promise<number> {
  const agora = Date.now();
  const corteLida = new Date(agora - (opcoes?.retencaoLidaMs ?? RETENCAO_LIDA_MS));
  const corteAbsoluto = new Date(agora - (opcoes?.retencaoAbsolutaMs ?? RETENCAO_ABSOLUTA_MS));

  // `companyId` obrigatório desde o Ciclo 1d, e a mudança de COMPORTAMENTO é
  // real — vale dizer qual é, porque um `deleteMany` que apaga menos coisa
  // parece regressão.
  //
  // Antes, uma navegação de QUALQUER empresa podava a tabela INTEIRA. Isso era
  // uma escrita destrutiva cross-tenant disparada por requisição de terceiro:
  // a empresa A apagando linhas da B. Não vazava dado (apagar não devolve
  // nada), mas é exatamente o tipo de operação que o escopo existe para
  // impedir, e nada aqui distinguia "faxina do deploy" de "uma empresa mexendo
  // no dado da outra".
  //
  // Hoje cada empresa poda a própria. O custo é convergência mais lenta: uma
  // empresa que ninguém abre não tem quem pode as notificações dela, e elas
  // ficam. Isso é aceitável pelo que a poda é — higiene oportunista, por
  // sorteio (`CHANCE_DE_PODA`), sem cron — e a tabela de uma empresa que
  // ninguém usa não cresce, porque o que a faz crescer é uso.
  const { count } = await prismaDaEmpresa(companyId).notification.deleteMany({
    where: {
      OR: [
        { lidaEm: { not: null }, criadoEm: { lt: corteLida } },
        { criadoEm: { lt: corteAbsoluto } },
      ],
    },
  });
  return count;
}

/**
 * Mesma poda probabilística do limitador de taxa
 * (`core/rate-limit/limiter.ts`), pelo mesmo motivo: cron exigiria rota nova,
 * segredo próprio e alguém configurando um agendador, e correção que depende de
 * configuração pode nunca entrar em vigor. Aqui vale sozinha.
 *
 * O argumento original citava "o painel da Vercel". A Vercel saiu no Ciclo 2d e
 * ele sobreviveu à troca inteiro, porque nunca foi sobre AQUELA plataforma — o
 * porquê longo está no bloco de `CHANCE_DE_PODA` do limitador, inclusive por
 * que o laço de `npm run fila:worker`, que existe desde o Ciclo 2d, não passou
 * a ser o lugar disto.
 *
 * O gancho é a listagem porque ela roda a cada navegação sob o layout do
 * painel — é o caminho frequente. 1% mantém a tabela sob controle deixando 99
 * de cada 100 navegações sem custo extra.
 */
const CHANCE_DE_PODA = 0.01;

async function podarDeVezEmQuando(companyId: string): Promise<void> {
  if (Math.random() >= CHANCE_DE_PODA) return;
  try {
    await podarNotificacoes(companyId);
  } catch (erro) {
    // Limpeza é higiene, não decisão de produto: falhar aqui nunca pode
    // impedir alguém de ver as próprias notificações.
    console.error("Falha ao podar notificações antigas:", erro);
  }
}

/**
 * Marca uma notificação como lida.
 *
 * Confere que `userId` é o dono da notificação (`notification.userId`) ANTES
 * de marcar — mesmo padrão de `concluirTask` (`tasks/service.ts`, Task 18):
 * `marcarComoLida` é chamada a partir de uma Server Action pública
 * (`marcarNotificacaoComoLidaAction`, `actions.ts`) com um id que veio do
 * cliente. Sem esta checagem, qualquer usuário autenticado marcaria como
 * lida a notificação de qualquer colega só adivinhando um id vizinho
 * (`cuid()` não impede a tentativa) — o mesmo buraco que a checagem de dono
 * de tarefa fechou na Task 18.
 *
 * A mensagem de erro é a MESMA ("Notificação não encontrada") tanto para
 * "id não existe" quanto para "existe mas não é minha" — de propósito, mesmo
 * raciocínio de `concluirTask`: não diferenciar os dois casos evita
 * confirmar, a quem está adivinhando ids, que aquele id específico existe.
 *
 * Assinatura deliberadamente DIFERENTE do brief original da Task 19
 * (`marcarComoLida(notificationId: string)`, sem `userId`): o brief está
 * desatualizado neste ponto — sem o id de quem está chamando, esta função
 * não tem como aplicar a checagem de dono acima, e viraria a mesma classe de
 * falha que a Task 13/18 já fechou para lead/tarefa.
 */
export async function marcarComoLida(input: {
  companyId: string;
  notificationId: string;
  userId: string;
}): Promise<void> {
  const db = prismaDaEmpresa(input.companyId);

  // Duas travas INDEPENDENTES, e é assim que elas precisam ser lidas: o escopo
  // recusa notificação de outra empresa (`findFirst` não a encontra), a regra
  // de dono recusa notificação de outra pessoa. A segunda escondia a falta da
  // primeira no caso comum, porque quase toda notificação de outra empresa
  // também é de outra pessoa — o caso que as separa é a pessoa com vínculo nas
  // duas.
  const notificacao = await db.notification.findFirst({ where: { id: input.notificationId } });
  if (!notificacao || notificacao.userId !== input.userId) {
    throw new Error("Notificação não encontrada");
  }

  // `updateMany` e não `update`: o escopo recusa `update` em modelo de tenant.
  // O retorno não é usado — a função devolve `void`.
  await db.notification.updateMany({
    where: { id: input.notificationId },
    data: { lidaEm: new Date() },
  });
}
