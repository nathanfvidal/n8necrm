// Este arquivo usa o Prisma real contra o Postgres do Supabase (mesmo padrão
// de seed.test.ts e companhia), então carrega DATABASE_URL do .env — aqui
// isso acontece via `import "dotenv/config"` dentro de prisma/seed-demo.ts
// (primeiro import abaixo), não em vitest.config.ts, pelo mesmo motivo já
// documentado nos outros arquivos de teste que tocam banco: não injetar
// credenciais em testes que não tocam banco.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança (ver tests/unit/storage.test.ts). Este arquivo
// importa `normalizarTelefone` de `src/core/leads/dedupe.ts`, que puxa
// `@/lib/prisma` (tem `import "server-only"`) mesmo só usando a função pura —
// sem mockar aqui, a importação quebraria antes de qualquer teste rodar.
// `prisma/seed-demo.ts`/`seed-demo-limpar.ts` NÃO precisam deste mock (não
// importam "server-only" nem `@/lib/prisma" — ver o comentário no topo
// desses arquivos): é só a importação de `dedupe.ts` abaixo que exige isto.
vi.mock("server-only", () => ({}));

import { seedDemo, prisma } from "../../prisma/seed-demo";
import { limparDemo } from "../../prisma/seed-demo-limpar";
import { TELEFONE_PREFIXO_DEMO } from "../../prisma/seed-demo-shared";
import { normalizarTelefone } from "../../src/core/leads/dedupe";
import { client } from "../../config/client";

const EMAILS_SEED_BASE = ["admin@exemplo.com", "vendedor@exemplo.com"];
const TELEFONE_PREFIXO_SEED_BASE = "1199999000";

async function contarLinhasDeDemo() {
  const contatos = await prisma.contact.findMany({
    where: { telefone: { startsWith: TELEFONE_PREFIXO_DEMO } },
  });
  const contatoIds = contatos.map((c) => c.id);
  const leads = await prisma.lead.findMany({
    where: { contactId: { in: contatoIds } },
    include: { stage: true },
  });
  const leadIds = leads.map((l) => l.id);

  const notas = await prisma.leadNote.count({ where: { leadId: { in: leadIds } } });
  const tarefas = await prisma.task.count({ where: { leadId: { in: leadIds } } });
  const auditLogs = await prisma.auditLog.count({ where: { entidade: "Lead", entidadeId: { in: leadIds } } });

  const notificacoesNovoLead = await prisma.notification.findMany({ where: { tipo: "NOVO_LEAD" } });
  const notificacoes = notificacoesNovoLead.filter((n) =>
    leadIds.includes((n.payload as { leadId?: string } | null)?.leadId ?? "")
  ).length;

  return { contatos, leads, leadIds, notas, tarefas, auditLogs, notificacoes };
}

async function contarLinhasDoSeedBase() {
  return {
    stages: await prisma.pipelineStage.count(),
    users: await prisma.user.count({ where: { email: { in: EMAILS_SEED_BASE } } }),
    contacts: await prisma.contact.count({ where: { telefone: { startsWith: TELEFONE_PREFIXO_SEED_BASE } } }),
    leads: await prisma.lead.count({
      where: { contact: { telefone: { startsWith: TELEFONE_PREFIXO_SEED_BASE } } },
    }),
  };
}

/**
 * `seedDemo()` exige um funil de exatamente 5 etapas (`seed-demo.ts`), e desde o
 * CRUD de etapas o funil deste banco pode ter qualquer tamanho. Sem esta guarda,
 * a primeira etapa criada pela tela derrubaria o `beforeAll` e, com ele, o
 * arquivo inteiro — deixando `npx vitest run`, que é o portão de merge do
 * projeto, vermelho para sempre por uma razão que não é defeito de ninguém.
 *
 * Pulado com motivo impresso é honesto; vermelho permanente treina a equipe a
 * ignorar o portão, que é o pior desfecho possível.
 */
const funilTemCincoEtapas = (await prisma.pipelineStage.count()) === 5;

describe.skipIf(!funilTemCincoEtapas)("prisma/seed-demo.ts", () => {
  // beforeAll/afterAll únicos para toda a suíte deste arquivo: `seedDemo()`
  // faz ~30 leads x vários round-trips contra o Postgres real — chamar uma
  // vez e reaproveitar entre os `it()`s de leitura é o que mantém a suíte
  // rápida. A suíte de idempotência (abaixo) chama `seedDemo()` de novo, de
  // propósito, dentro do próprio `it()`.
  beforeAll(async () => {
    await limparDemo(); // parte de resíduo conhecido, não do que este arquivo assume
    await seedDemo();
  }, 120_000);

  afterAll(async () => {
    // Deixa o banco compartilhado como encontrou — mesma disciplina de TODO
    // outro arquivo de teste que toca este Postgres (ver o comentário em
    // stage-transition.test.ts/lead-notes.test.ts sobre por que isto não é
    // opcional).
    await limparDemo();
    await prisma.$disconnect();
  }, 60_000);

  it("não altera PipelineStage nem User do seed base — só adiciona Contact/Lead na faixa reservada", async () => {
    const baseline = await contarLinhasDoSeedBase();
    expect(baseline.stages).toBe(client.funil.length);
    expect(baseline.users).toBe(2);
    // Contatos/leads do seed BASE (prefixo 1199999000{0-3}) continuam
    // exatamente 4 — a faixa de demo (11930...) nunca toca essa faixa.
    expect(baseline.contacts).toBe(4);
    expect(baseline.leads).toBe(4);
  });

  it("popula ~30 leads distribuídos nas 5 etapas do funil, na forma decrescente esperada (10/7/5/3/5)", async () => {
    const { leads } = await contarLinhasDeDemo();
    expect(leads).toHaveLength(30);

    const porOrdemDeEtapa = new Map<number, number>();
    for (const lead of leads) {
      porOrdemDeEtapa.set(lead.stage.ordem, (porOrdemDeEtapa.get(lead.stage.ordem) ?? 0) + 1);
    }
    expect([0, 1, 2, 3, 4].map((ordem) => porOrdemDeEtapa.get(ordem) ?? 0)).toEqual([10, 7, 5, 3, 5]);
  });

  it("taxa de conversão (ganhos / total) fica entre 15% e 20%, calculada a partir de PipelineStage.ehGanho", async () => {
    const { leads } = await contarLinhasDeDemo();
    const etapaGanha = await prisma.pipelineStage.findFirstOrThrow({ where: { ehGanho: true } });
    const ganhos = leads.filter((l) => l.stageId === etapaGanha.id).length;
    const taxa = (ganhos / leads.length) * 100;

    expect(ganhos).toBe(5);
    expect(taxa).toBeGreaterThanOrEqual(15);
    expect(taxa).toBeLessThanOrEqual(20);
  });

  it("~28 contatos únicos para 30 leads — pelo menos um comprador retorna com um segundo lead (spec §2.3)", async () => {
    const { contatos, leads } = await contarLinhasDeDemo();
    expect(contatos).toHaveLength(28);
    expect(leads.length).toBeGreaterThan(contatos.length);

    const contagemPorContato = new Map<string, number>();
    for (const lead of leads) {
      if (!lead.contactId) continue;
      contagemPorContato.set(lead.contactId, (contagemPorContato.get(lead.contactId) ?? 0) + 1);
    }
    const contatosComDoisLeads = [...contagemPorContato.values()].filter((n) => n === 2);
    expect(contatosComDoisLeads).toHaveLength(2);
  });

  it("todo telefone de contato de demo sobrevive à normalização de encontrarOuCriarContact sem mudar (11 dígitos, DDD 11, bloco reservado)", async () => {
    const { contatos } = await contarLinhasDeDemo();
    expect(contatos.length).toBeGreaterThan(0);
    for (const contato of contatos) {
      expect(contato.telefone).toMatch(/^11930\d{6}$/);
      expect(normalizarTelefone(contato.telefone)).toBe(contato.telefone);
    }
  });

  it("todo lead de demo tem valorEstimado dentro da faixa de veículo (R$ 25.000 a R$ 180.000)", async () => {
    const { leads } = await contarLinhasDeDemo();
    for (const lead of leads) {
      expect(lead.valorEstimado).not.toBeNull();
      const valor = Number(lead.valorEstimado);
      expect(valor).toBeGreaterThanOrEqual(25_000);
      expect(valor).toBeLessThanOrEqual(180_000);
    }
  });

  it("criadoEm dos leads de demo está espalhado pelas últimas semanas, não tudo hoje", async () => {
    const { leads } = await contarLinhasDeDemo();
    const hoje = new Date();
    const diasAtras = leads.map((l) => (hoje.getTime() - l.criadoEm.getTime()) / 86_400_000);

    // Nenhum lead "hoje" (criadoEm >= algumas horas atrás pra todos) e pelo
    // menos um lead claramente de semanas atrás.
    expect(diasAtras.every((d) => d >= 0)).toBe(true);
    expect(Math.max(...diasAtras)).toBeGreaterThan(14);
    // Não são todos o MESMO dia (a suíte inteira rodou em segundos, então se
    // a distribuição de dias tivesse dado errado, cairiam todos no mesmo
    // valor arredondado de dias).
    expect(new Set(diasAtras.map((d) => Math.floor(d))).size).toBeGreaterThan(5);
  });

  it("gera AuditLog consistente com os leads (1 criar_lead por lead, mais 1 mover_etapa por etapa percorrida)", async () => {
    const { leadIds, auditLogs } = await contarLinhasDeDemo();
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      include: { stage: true },
    });
    const movimentosEsperados = leads.reduce((soma, l) => soma + l.stage.ordem, 0);
    expect(auditLogs).toBe(leadIds.length + movimentosEsperados);

    const acoes = await prisma.auditLog.findMany({ where: { entidade: "Lead", entidadeId: { in: leadIds } } });
    expect(acoes.every((a) => a.acao === "criar_lead" || a.acao === "mover_etapa")).toBe(true);
  });

  it("gera 1 notificação NOVO_LEAD por lead de demo, espalhada entre os dois usuários do seed base", async () => {
    const { leadIds, notificacoes } = await contarLinhasDeDemo();
    expect(notificacoes).toBe(leadIds.length);
  });

  it("gera tarefas de demo, algumas atrasadas e algumas a vencer em breve, espalhadas entre os dois usuários", async () => {
    const { tarefas } = await contarLinhasDeDemo();
    expect(tarefas).toBeGreaterThan(0);

    const { leadIds } = await contarLinhasDeDemo();
    const tasks = await prisma.task.findMany({ where: { leadId: { in: leadIds } } });
    const agora = new Date();

    const atrasadas = tasks.filter((t) => t.vencimento.getTime() < agora.getTime());
    const aVencer = tasks.filter((t) => t.vencimento.getTime() >= agora.getTime());
    expect(atrasadas.length).toBeGreaterThan(0);
    expect(aVencer.length).toBeGreaterThan(0);

    const responsaveis = new Set(tasks.map((t) => t.responsavelId));
    expect(responsaveis.size).toBe(2);
  });

  it(
    "é idempotente: rodar seedDemo() de novo não duplica contato, lead, nota, tarefa, auditLog nem notificação",
    async () => {
      const antes = await contarLinhasDeDemo();

      await expect(seedDemo()).resolves.toBeUndefined();

      const depois = await contarLinhasDeDemo();
      expect(depois.contatos).toHaveLength(antes.contatos.length);
      expect(depois.leads).toHaveLength(antes.leads.length);
      expect(depois.notas).toBe(antes.notas);
      expect(depois.tarefas).toBe(antes.tarefas);
      expect(depois.auditLogs).toBe(antes.auditLogs);
      expect(depois.notificacoes).toBe(antes.notificacoes);
    },
    120_000
  );
});

// Mesma guarda do describe acima, e pelo mesmo motivo: os `it()`s abaixo
// também chamam `seedDemo()` diretamente, então também lançam (por sua vez,
// não pelo `beforeAll`) se o funil deste banco não tiver exatamente 5
// etapas.
describe.skipIf(!funilTemCincoEtapas)("prisma/seed-demo-limpar.ts", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "remove exatamente o que seedDemo() criou e devolve o banco ao baseline do seed original, sem tocar " +
      "PipelineStage/User/os 4 leads e 4 contatos do seed base",
    async () => {
      await limparDemo(); // limpa resíduo de execuções anteriores, se houver
      await seedDemo();

      const baselineAntes = await contarLinhasDoSeedBase();
      const demoAntes = await contarLinhasDeDemo();
      expect(demoAntes.leads.length).toBeGreaterThan(0);

      const resultado = await limparDemo();

      expect(resultado.leads).toBe(demoAntes.leads.length);
      expect(resultado.contatos).toBe(demoAntes.contatos.length);

      const demoDepois = await contarLinhasDeDemo();
      expect(demoDepois.contatos).toHaveLength(0);
      expect(demoDepois.leads).toHaveLength(0);
      expect(demoDepois.notas).toBe(0);
      expect(demoDepois.tarefas).toBe(0);
      expect(demoDepois.auditLogs).toBe(0);
      expect(demoDepois.notificacoes).toBe(0);

      // O seed base (etapas, usuários, os 4 leads/contatos originais) segue
      // intacto — limparDemo nunca toca fora da faixa reservada de telefone.
      const baselineDepois = await contarLinhasDoSeedBase();
      expect(baselineDepois).toEqual(baselineAntes);
    },
    120_000
  );

  it("rodar limparDemo() numa base já limpa não lança e devolve tudo zerado", async () => {
    const resultado = await limparDemo();
    expect(resultado).toEqual({ contatos: 0, leads: 0, tarefas: 0, notas: 0, auditLogs: 0, notificacoes: 0 });
  });
});
