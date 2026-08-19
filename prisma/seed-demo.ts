// Este script NÃO importa `@/lib/prisma` (o singleton que o resto do app
// usa) nem nenhum módulo de `src/core/**` que grava no banco (leads/service.ts,
// leads/notes.ts, tasks/service.ts, notifications/dispatch.ts, pipeline/stages.ts)
// — de propósito, não por descuido. Todos esses módulos, direta ou
// transitivamente, têm `import "server-only"` no topo (`src/lib/prisma.ts` é a
// raiz: TODO módulo que grava no banco importa `prisma` de lá). Fora da
// condição de resolução "react-server" que o build do Next.js aplica, esse
// pacote LANÇA incondicionalmente ao ser importado — confirmado rodando
// `npx tsx` puro contra uma cadeia de import equivalente a esta durante o
// desenvolvimento deste script: o processo morre na primeira linha, antes de
// qualquer lógica rodar. É o mesmo motivo, documentado, por trás de
// `tests/e2e/lead-to-won.spec.ts` ter seu próprio `PrismaClient` em vez de
// importar `@/lib/prisma` — só que ali o `vi.mock("server-only", ...)` do
// Vitest não está disponível (Playwright roda como processo Node comum), e
// AQUI a mesma restrição vale para `npm run seed:demo`, que também roda como
// processo Node comum via `tsx`, fora do pipeline de build do Next.
//
// Consequência aceita: a lógica de dedupe de contato, auditoria e notificação
// abaixo é uma REIMPLEMENTAÇÃO enxuta (não uma reexportação) do que
// `src/core/leads/dedupe.ts` / `src/core/audit/log.ts` /
// `src/core/notifications/dispatch.ts` já fazem — só o suficiente para este
// seed, sem duplicar a superfície inteira dessas funções (ex.: não há
// concorrência real dentro de um script sequencial, então a reimplementação
// de dedupe de contato aqui não precisa do tratamento de corrida P2002 que
// `encontrarOuCriarContact` tem). O formato gravado (campos, `payload` de
// notificação, `acao`/`entidade` de auditoria) replica exatamente o que essas
// funções produzem, para que os dados de demo sejam indistinguíveis de dados
// criados por um usuário real através da UI.
//
// `prisma/seed.ts` tinha o mesmo problema (`npx prisma db seed` falhava na
// importação de `@/lib/prisma` pelo motivo acima) — já corrigido, sem tocar
// neste arquivo: `prisma.config.ts` roda o seed com
// `tsx --conditions=react-server`, que faz `"server-only"` resolver para o
// no-op da condição "react-server" em vez de lançar. Ver o comentário em
// `prisma.config.ts` para o detalhe completo.
import "dotenv/config";

import { PrismaClient, Prisma } from "@prisma/client";
import type { Contact, Lead } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import type { NovoLeadPayload } from "../src/core/notifications/types";
import { telefoneDemo, assertTelefoneCanonico } from "./seed-demo-shared";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({ adapter });

// --- Marcação dos dados de demo -------------------------------------------
//
// Mecanismo de marcação (justificativa completa no relatório
// .superpowers/sdd/2026-07-28-crm-base-fase-0-1/seed-demo-report.md): um
// prefixo de telefone RESERVADO (`TELEFONE_PREFIXO_DEMO`,
// prisma/seed-demo-shared.ts — módulo compartilhado com seed-demo-limpar.ts,
// ver o comentário lá sobre por que ele precisa ficar num arquivo À PARTE,
// sem nenhum efeito colateral de topo), não uma coluna nova no schema.
//
// Por quê não uma coluna `isDemo`: este projeto já resolve exatamente este
// problema — "marcar linhas de um seed/teste para limpeza precisa num
// Postgres compartilhado, sem tocar dado real" — em TODO arquivo de teste que
// grava no banco (ver o comentário no topo de tests/unit/dedupe.test.ts,
// tests/unit/stage-transition.test.ts, tests/unit/lead-notes.test.ts etc.):
// cada arquivo reserva sua própria família de telefone (`119977*`, `119888*`,
// `119555*`, `119666*`, `119444*`, `119222*`, além do prefixo `1199999000{0-3}`
// do próprio seed base) e limpa por `startsWith`/`in` sobre esse valor. Uma
// coluna `isDemo` seria mais uma forma de fazer a mesma coisa, divergindo da
// convenção já estabelecida sem ganhar precisão nenhuma — `Contact.telefone`
// já é único e já é a chave de dedupe natural do domínio (spec §2.3), então
// reservar uma faixa dela é, literalmente, o mesmo mecanismo que todo o resto
// da suíte usa, aplicado a dados de demo em vez de dados de teste.
//
// Faixa escolhida: DDD 11 (São Paulo — plausível para uma revenda), 9º dígito
// de celular, bloco de assinante iniciado em "930". Conferido contra TODAS as
// famílias reservadas acima (nenhuma começa com "930" depois do 9) — sem
// colisão por construção, documentado aqui para quem reservar a próxima
// família não colidir com esta.

// --- PRNG determinístico -----------------------------------------------
//
// mulberry32: gerador simples, determinístico dada uma seed fixa. Usado só
// para variar valorEstimado/datas/quantidade de notas de um jeito que não
// pareça uma progressão mecânica óbvia — não para segurança. Seed fixa
// significa que rodar este script em máquinas diferentes produz sempre a
// MESMA distribuição de dados de demo, o que torna o relatório (taxa de
// conversão, contagens) reproduzível e verificável.
function mulberry32(seed: number): () => number {
  let estado = seed;
  return function random(): number {
    estado |= 0;
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copia = [...items];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// --- Dados de demo: mostruário automotivo, revenda pequena ----------------

const NOMES: string[] = [
  "Ricardo Almeida", "Juliana Santos", "Marcos Oliveira", "Patrícia Souza",
  "Eduardo Nogueira", "Camila Ferreira", "Bruno Rodrigues", "Larissa Martins",
  "Felipe Carvalho", "Vanessa Gomes", "André Barbosa", "Renata Duarte",
  "Diego Ribeiro", "Aline Cardoso", "Thiago Nascimento", "Bianca Araújo",
  "Gustavo Melo", "Priscila Teixeira", "Rodrigo Correia", "Simone Dias",
  "Leonardo Batista", "Tatiane Moreira", "Fábio Lopes", "Cristina Rocha",
  "Alexandre Pinto", "Débora Nunes", "Marcelo Vieira", "Carla Monteiro",
];
const QUANTIDADE_CONTATOS = NOMES.length; // 28

// Contatos que retornam meses depois interessados em outro veículo (spec
// §2.3 — "o mesmo comprador retorna" é o motivo de Contact/Lead serem
// tabelas separadas). Os dois índices abaixo ganham um SEGUNDO lead cada.
const INDICES_CONTATO_RETORNO = [3, 9]; // Patrícia Souza, Vanessa Gomes

// Um lead por contato (0..27), mais um lead extra para cada contato de
// retorno, no final da lista — 28 + 2 = 30 leads.
const CONTATO_POR_LEAD: number[] = [
  ...NOMES.map((_, indice) => indice),
  ...INDICES_CONTATO_RETORNO,
];
const TOTAL_LEADS = CONTATO_POR_LEAD.length; // 30

function totalEsperadoDeLeadsDoContato(indiceContato: number): number {
  return INDICES_CONTATO_RETORNO.includes(indiceContato) ? 2 : 1;
}

function nomeParaLead(leadIndex: number, indiceContato: number): string {
  // Na segunda visita, só o primeiro nome — como uma recepcionista
  // digitaria rápido reconhecendo alguém que já voltou. Não sobrescreve o
  // nome gravado no primeiro contato (mesma regra de negócio de
  // `encontrarOuCriarContact`), só varia o que É ENVIADO na segunda
  // chamada, para provar que a regra se aplica também aqui.
  const ehRetorno = leadIndex >= QUANTIDADE_CONTATOS;
  if (ehRetorno) return NOMES[indiceContato].split(" ")[0];
  return NOMES[indiceContato];
}

// Forma do funil: distribuição decrescente até "Proposta", com um grupo de
// leads ganhos em "Fechado" — resulta em taxa de conversão de 5/30 = 16,7%,
// dentro da faixa pedida (15-20%) e não um número redondo/inventado.
const CONTAGEM_POR_ETAPA = [10, 7, 5, 3, 5]; // Novo, Contato feito, Visita agendada, Proposta, Fechado
if (CONTAGEM_POR_ETAPA.reduce((soma, n) => soma + n, 0) !== TOTAL_LEADS) {
  throw new Error("CONTAGEM_POR_ETAPA não soma TOTAL_LEADS — ajuste as constantes acima.");
}

// Janela de "quantos dias atrás" por etapa final do lead — leads mais
// adiante no funil tendem a ser mais antigos (fizeram mais progresso desde
// que entraram), o que é o que torna criadoEm/ultimaInteracaoEm plausíveis
// em vez de tudo datado de hoje.
const FAIXA_DIAS_ATRAS: Array<[number, number]> = [
  [0, 8], // Novo
  [3, 14], // Contato feito
  [8, 22], // Visita agendada
  [14, 28], // Proposta
  [18, 38], // Fechado
];

const NOTAS_POSSIVEIS = [
  "Cliente pediu pra retornar depois das 18h.",
  "Quer avaliar o usado dele na troca.",
  "Perguntou sobre condições de financiamento em 48x.",
  "Já visitou a loja, ainda decidindo entre dois modelos.",
  "Prefere agendar visita pro sábado de manhã.",
  "Pediu pra mandar fotos do interior por WhatsApp.",
  "Está comparando com uma oferta de outra revenda.",
  "Sinalizou que fecha se conseguirmos baixar um pouco o preço.",
  "Sem retorno depois de dois contatos, tentar de novo semana que vem.",
  "Aprovado no financiamento, só falta assinar.",
  "Trouxe a esposa pra ver o carro no fim de semana.",
  "Perguntou se tem garantia estendida.",
];

// Tarefas de demo: cada uma vinculada a um lead específico (por índice na
// lista de leads criados nesta execução), com vencimento no passado
// (atrasada) ou nos próximos dias (a vencer em breve) — cobre os dois casos
// pedidos, espalhados entre os dois usuários semeados via o responsável do
// próprio lead.
const TAREFAS_DEMO: Array<{ leadIndex: number; titulo: string; diasVencimento: number }> = [
  { leadIndex: 0, titulo: "Ligar para confirmar interesse", diasVencimento: -2 },
  { leadIndex: 1, titulo: "Enviar catálogo por WhatsApp", diasVencimento: 1 },
  { leadIndex: 4, titulo: "Confirmar horário da visita agendada", diasVencimento: -1 },
  { leadIndex: 6, titulo: "Retornar ligação perdida", diasVencimento: 2 },
  { leadIndex: 9, titulo: "Agendar test-drive", diasVencimento: -3 },
  { leadIndex: 12, titulo: "Avaliar veículo usado do cliente na troca", diasVencimento: 1 },
  { leadIndex: 15, titulo: "Enviar proposta por e-mail", diasVencimento: -1 },
  { leadIndex: 18, titulo: "Revisar condições de financiamento com o gerente", diasVencimento: 3 },
  { leadIndex: 21, titulo: "Follow-up pós-proposta", diasVencimento: -4 },
  { leadIndex: 24, titulo: "Confirmar documentação para fechamento", diasVencimento: 1 },
  { leadIndex: 27, titulo: "Agendar entrega do veículo", diasVencimento: 2 },
  { leadIndex: 29, titulo: "Ligar pedindo indicação de amigos", diasVencimento: -2 },
];

// --- Reimplementação enxuta das operações de escrita -----------------------
// (ver comentário no topo do arquivo sobre por que não importamos
// src/core/**/*.ts diretamente aqui)

async function encontrarOuCriarContactDemo(nome: string, telefone: string): Promise<Contact> {
  const existente = await prisma.contact.findUnique({ where: { telefone } });
  if (existente) return existente;
  return prisma.contact.create({ data: { nome, telefone } });
}

async function registrarAuditoriaDemo(params: {
  userId: string;
  acao: string;
  entidadeId: string;
  antes?: unknown;
  depois?: unknown;
  criadoEm: Date;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      acao: params.acao,
      entidade: "Lead",
      entidadeId: params.entidadeId,
      antes: params.antes === undefined ? undefined : JSON.parse(JSON.stringify(params.antes)),
      depois: params.depois === undefined ? undefined : JSON.parse(JSON.stringify(params.depois)),
      criadoEm: params.criadoEm,
    },
  });
}

async function notificarNovoLeadDemo(
  leadId: string,
  responsavelId: string,
  contatoNome: string,
  criadoEm: Date
): Promise<void> {
  const payload: NovoLeadPayload = { leadId, contatoNome };
  await prisma.notification.create({
    data: { userId: responsavelId, tipo: "NOVO_LEAD", payload, criadoEm },
  });
}

function arredondarPara(valor: number, multiplo: number): number {
  return Math.round(valor / multiplo) * multiplo;
}

/**
 * Popula um funil "em uso" para uma pequena revenda de veículos: ~30 leads
 * espalhados pelas 5 etapas do funil (formato decrescente até "Proposta",
 * com um grupo em "Fechado"), contatos com nome/telefone plausíveis, notas
 * de venda, tarefas atrasadas e a vencer, e AuditLog consistente com cada
 * lead (criação + movimentação de etapa) — para o dono navegar um sistema
 * que parece em uso, não os 4 leads placeholder do seed base.
 *
 * Idempotente: identifica dado já semeado pelo par (telefone do contato,
 * quantidade de leads já existente para aquele contato) — mesma lógica que
 * `prisma/seed.ts` já usa para Lead ("só cria se ainda não existe um lead
 * para este contato"), estendida para permitir até 2 leads nos 2 contatos de
 * "retorno". Rodar duas vezes seguidas não duplica nada.
 */
export async function seedDemo(): Promise<void> {
  const etapas = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
  if (etapas.length !== 5) {
    throw new Error(
      `seed-demo.ts assume um funil de 5 etapas — encontrei ${etapas.length} PipelineStage no banco. ` +
        "Duas causas possíveis: (1) o funil nunca foi semeado, e aí rode `npx prisma db seed` primeiro; " +
        "(2) alguém criou ou removeu etapa pela tela /etapas, e aí a distribuição hardcoded " +
        "(CONTAGEM_POR_ETAPA/FAIXA_DIAS_ATRAS) precisa ser ajustada para o novo tamanho do funil. " +
        "O seed de demonstração continua acoplado ao funil de 5 etapas de propósito — ver a § 3 da spec " +
        "docs/superpowers/specs/2026-08-14-crud-etapas-do-funil-design.md."
    );
  }

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
  const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@exemplo.com" } });
  const usuarios = [admin, vendedor];

  const rng = mulberry32(42);
  const agora = new Date();

  const stageIndexPorLead = shuffle(
    CONTAGEM_POR_ETAPA.flatMap((quantidade, etapaIndex) => Array(quantidade).fill(etapaIndex) as number[]),
    rng
  );

  const leadsCriadosOuEncontrados: Lead[] = [];
  const responsavelPorLead: string[] = [];
  let totalNotasCriadas = 0;
  let totalMovimentosCriados = 0;

  for (let leadIndex = 0; leadIndex < TOTAL_LEADS; leadIndex++) {
    const indiceContato = CONTATO_POR_LEAD[leadIndex];
    const telefone = telefoneDemo(indiceContato);
    assertTelefoneCanonico(telefone);
    const nome = nomeParaLead(leadIndex, indiceContato);
    const responsavel = usuarios[leadIndex % 2];

    const contact = await encontrarOuCriarContactDemo(nome, telefone);
    const leadsExistentesDoContato = await prisma.lead.count({ where: { contactId: contact.id } });

    if (leadsExistentesDoContato >= totalEsperadoDeLeadsDoContato(indiceContato)) {
      // Já semeado numa execução anterior — recupera o lead correspondente
      // pra usar na etapa de tarefas abaixo, sem criar nada de novo.
      // Ordena por `id` (cuid, monotonicamente crescente na ordem real de
      // inserção), NÃO por `criadoEm`: este script grava `criadoEm`
      // retrodatado aleatoriamente por lead (ver FAIXA_DIAS_ATRAS abaixo), e
      // dois leads do mesmo contato (o "fundador" e o de "retorno") podem
      // sortear datas que invertem a ordem cronológica aparente entre eles —
      // ordenar por `criadoEm` faria esta função devolver o lead ERRADO pra
      // cada posição em execuções diferentes, embaralhando qual lead recebe
      // qual tarefa em TAREFAS_DEMO (bug reproduzido: rodar o seed duas vezes
      // criava 2 tarefas "duplicadas" porque a 2ª execução resolvia leadIndex
      // 9 e 29 — o par fundador/retorno do mesmo contato — trocados um pelo
      // outro). `id` não tem esse problema: nunca é retrodatado.
      const leadsDoContato = await prisma.lead.findMany({
        where: { contactId: contact.id },
        orderBy: { id: "asc" },
      });
      const posicao = leadIndex >= QUANTIDADE_CONTATOS ? 1 : 0;
      leadsCriadosOuEncontrados.push(leadsDoContato[posicao] ?? leadsDoContato[0]);
      responsavelPorLead.push(responsavel.id);
      continue;
    }

    const stageIndexFinal = stageIndexPorLead[leadIndex];
    const [minDias, maxDias] = FAIXA_DIAS_ATRAS[stageIndexFinal];
    const diasAtras = randInt(rng, minDias, maxDias);
    const criadoEm = new Date(agora.getTime() - diasAtras * 86_400_000);
    const valorEstimado = arredondarPara(25_000 + rng() * (180_000 - 25_000), 500);

    const lead = await prisma.lead.create({
      data: {
        contactId: contact.id,
        stageId: etapas[0].id,
        responsavelId: responsavel.id,
        canal: "MANUAL",
        valorEstimado: new Prisma.Decimal(valorEstimado),
        criadoEm,
        ultimaInteracaoEm: criadoEm,
      },
    });

    await registrarAuditoriaDemo({
      userId: responsavel.id,
      acao: "criar_lead",
      entidadeId: lead.id,
      depois: lead,
      criadoEm,
    });
    await notificarNovoLeadDemo(lead.id, responsavel.id, contact.nome, criadoEm);

    // Move o lead pelas etapas intermediárias até a etapa final sorteada,
    // espaçando os timestamps de forma monotônica entre criadoEm e agora —
    // é isso que faz ultimaInteracaoEm variar de lead pra lead (spec: "vary
    // ultimaInteracaoEm too") e o AuditLog contar uma história plausível.
    const totalIntervaloMs = agora.getTime() - criadoEm.getTime();
    let ultimaData = criadoEm;
    let etapaAnteriorId = etapas[0].id;
    for (let s = 1; s <= stageIndexFinal; s++) {
      const fracao = s / (stageIndexFinal + 1);
      const dataMovimento = new Date(criadoEm.getTime() + totalIntervaloMs * fracao);
      const etapaAtualId = etapas[s].id;

      await prisma.lead.update({
        where: { id: lead.id },
        data: { stageId: etapaAtualId, ultimaInteracaoEm: dataMovimento },
      });
      await registrarAuditoriaDemo({
        userId: responsavel.id,
        acao: "mover_etapa",
        entidadeId: lead.id,
        antes: { stageId: etapaAnteriorId },
        depois: { stageId: etapaAtualId },
        criadoEm: dataMovimento,
      });

      etapaAnteriorId = etapaAtualId;
      ultimaData = dataMovimento;
      totalMovimentosCriados++;
    }

    // Notas: leads mais adiantados no funil acumulam mais interações
    // registradas; leads recém-chegados às vezes já têm uma nota de
    // primeiro contato.
    const quantidadeNotas =
      stageIndexFinal === 0 ? (rng() < 0.3 ? 1 : 0) : stageIndexFinal === 4 ? 2 : 1;
    for (let n = 0; n < quantidadeNotas; n++) {
      const texto = NOTAS_POSSIVEIS[randInt(rng, 0, NOTAS_POSSIVEIS.length - 1)];
      const dataNota = new Date(criadoEm.getTime() + rng() * (ultimaData.getTime() - criadoEm.getTime()));
      await prisma.leadNote.create({
        data: { leadId: lead.id, autorId: responsavel.id, texto, criadoEm: dataNota },
      });
      totalNotasCriadas++;
    }

    leadsCriadosOuEncontrados.push(lead);
    responsavelPorLead.push(responsavel.id);
  }

  // Tarefas: vinculadas a leads específicos (por índice de criação acima),
  // responsável = o mesmo responsável do lead (o que já espalha entre os
  // dois usuários, já que leads alternam responsável par/ímpar). Idempotente
  // por (leadId, titulo): cada lead da lista só recebe UMA tarefa de demo.
  let totalTarefasCriadas = 0;
  for (const tarefa of TAREFAS_DEMO) {
    const lead = leadsCriadosOuEncontrados[tarefa.leadIndex];
    if (!lead) continue;

    const existente = await prisma.task.findFirst({
      where: { leadId: lead.id, titulo: tarefa.titulo },
    });
    if (existente) continue;

    const responsavelId = responsavelPorLead[tarefa.leadIndex];
    const vencimento = new Date(agora.getTime() + tarefa.diasVencimento * 86_400_000);
    const criacaoTarefa = new Date(vencimento.getTime() - randInt(rng, 2, 6) * 86_400_000);

    await prisma.task.create({
      data: {
        titulo: tarefa.titulo,
        vencimento,
        responsavelId,
        leadId: lead.id,
        criadoEm: criacaoTarefa > agora ? agora : criacaoTarefa,
      },
    });
    totalTarefasCriadas++;
  }

  const totalGanhos = stageIndexPorLead.filter((indice) => indice === 4).length;
  const taxaConversao = ((totalGanhos / TOTAL_LEADS) * 100).toFixed(1);
  console.log(
    `Seed de demo concluído: ${TOTAL_LEADS} leads (${CONTAGEM_POR_ETAPA.join("/")} por etapa), ` +
      `${totalGanhos}/${TOTAL_LEADS} ganhos (${taxaConversao}%), ${totalNotasCriadas} notas, ` +
      `${totalTarefasCriadas} tarefas, ${totalMovimentosCriados} movimentações de etapa registradas em AuditLog.`
  );
}

// Mesma guarda de prisma/seed.ts: importar `seedDemo` a partir de um teste
// não deve disparar também esta invocação de topo de arquivo.
if (!process.env.VITEST) {
  seedDemo()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
