// `import "server-only"` — mesmo padrão de `src/lib/prisma.ts`,
// `src/core/leads/notes.ts` e `src/core/tasks/service.ts`: este módulo
// importa Prisma diretamente (e, agora, também o SDK do Resend, que espera
// rodar em servidor). Sem esta linha, o único motivo pelo qual um Client
// Component não conseguiria importar isto seria coincidência do bundler, não
// uma garantia.
import "server-only";

import { after } from "next/server";
import { Resend } from "resend";

import { prisma } from "@/lib/prisma";
import { NovoLeadEmail } from "./email";
import type { NovoLeadPayload } from "./types";
import type { Notification } from "@prisma/client";

// `resend` é `null` quando `RESEND_API_KEY` não está definida — o caso real
// deste projeto hoje: a Task 19 é explícita que a chave fica de fora do
// `.env` (não há conta Resend real disponível), então o caminho de e-mail
// nunca é exercitado de verdade, nem em dev nem nos testes. `null` em vez de
// instanciar `Resend("")` é deliberado: o SDK não valida a chave na
// construção, então um `new Resend("")` "funcionaria" até a primeira
// chamada de rede falhar com um erro de autenticação genérico — pior sinal
// para debugar do que simplesmente nunca tentar enviar.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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
 * - O envio de e-mail É envolvido em try/catch, e SEMPRE roda depois da
 *   notificação in-app já estar gravada: um Resend fora do ar (ou, no caso
 *   comum deste projeto, `resend === null` porque a chave não existe) nunca
 *   deveria impedir a pessoa de ver a notificação dentro do próprio CRM.
 *   `console.error` é o único registro de uma falha de e-mail — sem retry,
 *   sem fila (a spec descreve entrega com retry via QStash como alvo
 *   futuro; esta fase implementa só o "melhor esforço" mais simples).
 */
export async function notificarNovoLead(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({
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

  await prisma.notification.create({
    data: {
      userId: lead.responsavel.id,
      tipo: "NOVO_LEAD",
      payload,
    },
  });

  if (!resend) return;

  try {
    await resend.emails.send({
      from: "CRM <notificacoes@exemplo.com>",
      to: lead.responsavel.email,
      subject: "Novo lead recebido",
      react: NovoLeadEmail({
        contatoNome: payload.contatoNome,
        etapaNome: lead.stage.nome,
      }),
    });
  } catch (erro) {
    console.error("Falha ao enviar e-mail de notificação de novo lead:", erro);
  }
}

/**
 * Lista as notificações não lidas de um usuário, mais recente primeiro.
 * Sempre escopada por `userId` — quem chama (o sino, `notification-bell.tsx`,
 * via layout do painel) sempre passa o id do usuário da sessão atual, nunca
 * um id arbitrário vindo do cliente.
 */
export async function listarNotificacoesNaoLidas(userId: string): Promise<Notification[]> {
  const naoLidas = await prisma.notification.findMany({
    where: { userId, lidaEm: null },
    orderBy: { criadoEm: "desc" },
  });

  agendarPoda();

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
 * ## Por que o `try`
 *
 * `after()` só existe dentro de contexto de requisição. `tests/unit/
 * notifications.test.ts` chama `listarNotificacoesNaoLidas` direto, sob
 * Vitest, onde esse contexto não existe — sem o `try`, a chamada lançaria e
 * derrubaria testes que não têm nada a ver com poda.
 *
 * Perder a poda nesses casos é aceitável e não silencia nada que importe: ela
 * é oportunista por construção (roda por sorteio, ver `CHANCE_DE_PODA`), o
 * próximo carregamento real do painel volta a sorteá-la, e `podarNotificacoes`
 * tem testes próprios que a exercitam diretamente
 * (`tests/unit/notificacoes-poda.test.ts`).
 */
function agendarPoda(): void {
  try {
    after(() => podarDeVezEmQuando());
  } catch {
    // Sem contexto de requisição. Ver acima: a poda simplesmente não acontece
    // nesta chamada, e nenhuma decisão de produto depende disso.
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
export async function podarNotificacoes(opcoes?: {
  retencaoLidaMs?: number;
  retencaoAbsolutaMs?: number;
}): Promise<number> {
  const agora = Date.now();
  const corteLida = new Date(agora - (opcoes?.retencaoLidaMs ?? RETENCAO_LIDA_MS));
  const corteAbsoluto = new Date(agora - (opcoes?.retencaoAbsolutaMs ?? RETENCAO_ABSOLUTA_MS));

  const { count } = await prisma.notification.deleteMany({
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
 * segredo próprio e configuração no painel da Vercel, e correção que depende
 * de configuração pode nunca entrar em vigor. Aqui vale sozinha.
 *
 * O gancho é a listagem porque ela roda a cada navegação sob o layout do
 * painel — é o caminho frequente. 1% mantém a tabela sob controle deixando 99
 * de cada 100 navegações sem custo extra.
 */
const CHANCE_DE_PODA = 0.01;

async function podarDeVezEmQuando(): Promise<void> {
  if (Math.random() >= CHANCE_DE_PODA) return;
  try {
    await podarNotificacoes();
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
export async function marcarComoLida(input: { notificationId: string; userId: string }): Promise<void> {
  const notificacao = await prisma.notification.findUnique({ where: { id: input.notificationId } });
  if (!notificacao || notificacao.userId !== input.userId) {
    throw new Error("Notificação não encontrada");
  }

  await prisma.notification.update({
    where: { id: input.notificationId },
    data: { lidaEm: new Date() },
  });
}
