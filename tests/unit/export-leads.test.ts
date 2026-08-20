// Teste de unidade puro (sem Prisma real, mesmo padrão de
// tests/unit/lead-actions.test.ts): mocka `usuarioAtual()` e `listarLeads()`
// para isolar a rota `(painel)/export/leads/route.ts` de banco/sessão HTTP
// real, e mantém `hasPermission` REAL (matriz de core/auth/permissions.ts)
// para provar 401/403 contra a autorização de verdade, não uma simulação.
// Sem mockar `@/core/auth/session` e `@/core/leads/queries`, a importação da
// rota puxaria `@/lib/prisma` (que tem `import "server-only"`) e exigiria
// DATABASE_URL — este arquivo testa só a rota, não o banco.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User, Lead, Contact, PipelineStage } from "@prisma/client";
import type { UsuarioAtivo } from "@/core/auth/usuario-ativo";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

// `listarLeads` passou a devolver `{ itens, truncado }` (teto das listagens,
// `core/listagem.ts`). O mock embrulha aqui para que os `mockResolvedValue`
// dos ~30 casos abaixo continuem passando o ARRAY de leads, que é o que cada
// um deles realmente quer descrever — e não a forma do envelope.
//
// `truncado: false` fixo: a exportação chama com `semTeto: true` e nunca
// trunca. É o que o teste logo abaixo ("pede a listagem SEM teto") garante.
const listarLeadsMock = vi.fn();
const listarLeadsArgsMock = vi.fn();
vi.mock("@/core/leads/queries", () => ({
  listarLeads: async (...args: unknown[]) => {
    listarLeadsArgsMock(...args);
    return { itens: await listarLeadsMock(), truncado: false };
  },
}));

// Auditoria e rate limit chegaram na Fase 2 da auditoria de segurança. Os dois
// são mockados pelo mesmo motivo dos de cima: `@/core/audit/log` importa
// `@/lib/prisma` (que tem `import "server-only"`), e este arquivo testa a
// rota, não o banco.
const registrarAuditoriaMock = vi.fn();
vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: (...args: unknown[]) => registrarAuditoriaMock(...args),
}));

const checarRateLimitMock = vi.fn();
vi.mock("@/core/rate-limit/limiter", () => ({
  checarRateLimit: (...args: unknown[]) => checarRateLimitMock(...args),
}));

const { GET } = await import("../../src/app/(painel)/export/leads/route");

// Política (limite/janela) importada de verdade, não repetida como número
// solto aqui: se alguém afrouxar a cota no módulo, o teste acompanha em vez
// de virar um literal desatualizado guardando um valor que não existe mais.
const { LIMITE_EXPORT_POR_CONTA, JANELA_EXPORT_MS } = await import(
  "../../src/core/rate-limit/export-leads"
);

/**
 * A rota passou a receber a `Request` (antes era `GET()` sem argumento) porque
 * precisa do IP de origem para a auditoria — `obterIpDaRequisicao` lê header.
 * `x-vercel-forwarded-for` é o header que a própria borda da Vercel define e
 * que o cliente não consegue forjar (ver `src/lib/ip.ts`).
 */
function requisicaoFake(ip = "203.0.113.7"): Request {
  return new Request("http://localhost/export/leads", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}

/**
 * `UsuarioAtivo`, e NÃO `User` do Prisma.
 *
 * Era `User` — com `senhaHash` e `criadoEm`, sem `companyId`. Isso deixou de
 * descrever o que `usuarioAtual()` devolve quando a Task 2 do Ciclo 1a trocou
 * o retorno por `UsuarioAtivo` (`core/auth/usuario-ativo.ts`): a projeção sem
 * hash de senha, com a EMPRESA da requisição e o papel vindo do `Membership`.
 *
 * Enquanto o mock mentia sobre a forma, a rota podia ler `usuario.companyId` e
 * receber `undefined` sem nenhum caso ficar vermelho — o teste passaria por
 * cima de uma exportação sem escopo, que é justamente o que esta rota não pode
 * fazer (ela tira a base inteira de clientes num arquivo só).
 */
const EMPRESA_FAKE = "empresa-fake-id";

function usuarioFake(overrides: Partial<UsuarioAtivo>): UsuarioAtivo {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    papel: "ADMIN",
    ativo: true,
    companyId: EMPRESA_FAKE,
    ...overrides,
  };
}

const etapaFake: PipelineStage = {
  id: "stage-1",
  companyId: "empresa-fake-id",
  nome: "Novo",
  ordem: 0,
  cor: "#000000",
  ehGanho: false,
  ehPerdido: false,
};

function contactFake(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "contact-1",
    companyId: "empresa-fake-id",
    nome: "Nome Qualquer",
    telefone: "11999990000",
    email: null,
    // Campos do cadastro de pessoa. Nulos aqui de propósito: este arquivo
    // testa a EXPORTAÇÃO de leads, e o CSV não os inclui. O fixture precisa
    // deles só porque `Contact` é o tipo completo do Prisma — se um dia o CSV
    // passar a exportar empresa ou documento, é aqui que o teste correspondente
    // vai querer valores de verdade.
    empresa: null,
    cargo: null,
    documento: null,
    endereco: null,
    cidade: null,
    uf: null,
    observacoes: null,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    atualizadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

type LeadFake = Lead & {
  contact: Contact | null;
  responsavel: Pick<User, "id" | "nome"> | null;
  stage: PipelineStage;
};

function leadFake(overrides: Partial<LeadFake> = {}): LeadFake {
  return {
    id: "lead-1",
    companyId: "empresa-fake-id",
    contactId: "contact-1",
    itemId: null,
    stageId: "stage-1",
    responsavelId: "usuario-fake-id",
    canal: "MANUAL",
    valorEstimado: null,
    sessionId: null,
    utm: null,
    criadoEm: new Date("2026-08-02T12:34:00.000Z"),
    ultimaInteracaoEm: new Date("2026-08-02T12:34:00.000Z"),
    // Lead ativo. `arquivadoEm` nasceu com a edição/arquivamento
    // (2026-08-08) e é obrigatório no tipo, ainda que nulo.
    arquivadoEm: null,
    contact: contactFake(),
    responsavel: { id: "usuario-fake-id", nome: "Responsável Fake" },
    stage: etapaFake,
    ...overrides,
  };
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  listarLeadsMock.mockReset();
  // Padrão "caminho feliz" para os dois controles novos, para que os testes
  // que existiam antes da Fase 2 continuem exercitando o que exercitavam:
  // dentro da cota, e com a auditoria gravando sem erro.
  checarRateLimitMock.mockReset().mockResolvedValue(true);
  registrarAuditoriaMock.mockReset().mockResolvedValue(undefined);
  listarLeadsArgsMock.mockReset();
});

// O teto das listagens (`core/listagem.ts`) corta em 1000 linhas por padrão.
// Um CSV com 1000 de 1500 leads é indistinguível de um CSV completo para quem
// abre a planilha — viraria decisão de negócio tomada sobre dado faltando.
// Esta é a única chamada do sistema que pede a listagem inteira, e o teste
// existe para que ninguém remova o `semTeto` por engano ao mexer na rota.
describe("GET /export/leads — a exportacao nunca e' truncada", () => {
  it("pede a listagem SEM teto", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake()]);

    await GET(requisicaoFake());

    // A empresa vem de `usuarioAtual().companyId`, e é o primeiro
    // argumento — não um campo dentro de `opcoes`, e nunca algo vindo da
    // requisição. Ver `listarLeads` em `core/leads/queries.ts`.
    expect(listarLeadsArgsMock).toHaveBeenCalledWith(EMPRESA_FAKE, { semTeto: true });
  });
});

describe("GET /export/leads — autorização", () => {
  it("devolve 401 quando usuarioAtual rejeita (sem sessão OU usuário desativado) e não chama listarLeads", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual({ erro: "Não autenticado" });
    expect(listarLeadsMock).not.toHaveBeenCalled();
  });

  it("devolve 403 para VENDEDOR (papel real, sem exportar_leads na matriz) e não chama listarLeads", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({ erro: "Sem permissão" });
    expect(listarLeadsMock).not.toHaveBeenCalled();
  });

  it("ADMIN (papel real, com exportar_leads) recebe 200", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake()]);

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(200);
  });

  it("GESTOR (papel real, com exportar_leads) recebe 200", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "GESTOR" }));
    listarLeadsMock.mockResolvedValue([leadFake()]);

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(200);
  });
});

describe("GET /export/leads — cabeçalhos do CSV", () => {
  it("Content-Type é text/csv com charset utf-8, e Content-Disposition força o download como leads.csv", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake()]);

    const resposta = await GET(requisicaoFake());

    expect(resposta.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(resposta.headers.get("Content-Disposition")).toBe("attachment; filename=leads.csv");
  });
});

describe("GET /export/leads — formato Excel pt-BR", () => {
  it(
    "os 3 primeiros bytes do corpo são o BOM UTF-8 (EF BB BF) — sem ele, Excel pt-BR abre o " +
      "arquivo como Windows-1252 e acentua errado. Checado em bytes crus (arrayBuffer), não via " +
      "`.text()`: `TextDecoder` (usado por `Response#text()`) consome/descarta um BOM líder por " +
      "padrão ao decodificar UTF-8 — checar depois de `.text()` esconderia o próprio bug que este " +
      "teste existe para pegar.",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
      listarLeadsMock.mockResolvedValue([leadFake()]);

      const resposta = await GET(requisicaoFake());
      const bytes = new Uint8Array(await resposta.arrayBuffer());

      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    }
  );

  it("usa ';' como delimitador de campo (não ','), e o cabeçalho tem as 6 colunas esperadas", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake()]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();
    const [cabecalho] = corpo.split("\r\n");

    expect(cabecalho).toBe("Contato;Telefone;Etapa;Responsável;Canal;Criado em");
  });

  it("acentos (São Paulo, João, Conceição) chegam intactos no corpo do CSV — não em mojibake", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "João Conceição — São Paulo" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("João Conceição — São Paulo");
  });

  it("telefone é exportado formatado como (DD) NNNNN-NNNN (celular, 11 dígitos), não como dígito cru", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ telefone: "11999990000" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("(11) 99999-0000");
    expect(corpo).not.toContain(";11999990000;");
  });

  it("telefone fixo (10 dígitos) é exportado como (DD) NNNN-NNNN", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ telefone: "1133330000" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("(11) 3333-0000");
  });

  it("lead sem contato (origem WhatsApp, Lead.contact null): 'Sem contato identificado' e '—' no telefone", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake({ contact: null })]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();
    const [, linha] = corpo.split("\r\n");

    expect(linha.split(";")[0]).toBe("Sem contato identificado");
    expect(linha.split(";")[1]).toBe("—");
  });

  it("lead sem responsável: 'Sem responsável' — mesma redação de page.tsx/lead-table.tsx", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake({ responsavel: null })]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();
    const [, linha] = corpo.split("\r\n");

    expect(linha.split(";")[3]).toBe("Sem responsável");
  });

  it("canal é traduzido (WHATSAPP -> WhatsApp), mesma rotulagem de lead-table.tsx/kanban-card.tsx", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake({ canal: "WHATSAPP", contact: null })]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("WhatsApp");
  });

  it("criadoEm é formatado como DD/MM/AAAA HH:mm no fuso America/Sao_Paulo, não ISO 8601 cru", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      // 12:34 UTC = 09:34 em São Paulo (UTC-3, sem horário de verão hoje).
      leadFake({ criadoEm: new Date("2026-08-02T12:34:00.000Z") }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("02/08/2026 09:34");
    expect(corpo).not.toContain("2026-08-02T12:34");
  });
});

describe("GET /export/leads — injeção de fórmula CSV (CSV injection)", () => {
  it(
    "nome de contato começando com '=' (ex.: fórmula maliciosa vinda de um formulário público na " +
      "Fase 2) é neutralizado com um apóstrofo prefixado, não exportado como fórmula executável",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
      listarLeadsMock.mockResolvedValue([
        leadFake({ contact: contactFake({ nome: '=cmd|"/c calc"!A1' }) }),
      ]);

      const resposta = await GET(requisicaoFake());
      const corpo = await resposta.text();
      const [, linhaDoLead] = corpo.split("\r\n");

      // "Contato" é a primeira coluna: um nome não neutralizado faria a
      // LINHA em si começar com "=", exatamente o que o Excel interpreta
      // como início de fórmula ao abrir o arquivo.
      expect(linhaDoLead.startsWith("=cmd|")).toBe(false);
      // Neutralizado com apóstrofo à frente, dentro do campo entre aspas
      // (o valor também tem `"` embutido, então cai na regra de quoting):
      expect(linhaDoLead.startsWith('"\'=cmd|')).toBe(true);
    }
  );

  it("nome começando com '+' é neutralizado", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake({ contact: contactFake({ nome: "+1+1" }) })]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("'+1+1");
    expect(corpo).not.toMatch(/;\+1\+1/);
  });

  it("nome começando com '-' é neutralizado", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake({ contact: contactFake({ nome: "-1+1" }) })]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("'-1+1");
  });

  it("nome começando com '@' é neutralizado", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "@SUM(1,1)" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("'@SUM(1,1)");
  });

  it("um '=' no MEIO do nome (não na primeira posição) não é tocado — só o início do campo importa para o Excel", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "Carlos = Silva" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("Carlos = Silva");
    expect(corpo).not.toContain("'Carlos");
  });

  it(
    "fix round 1/5 (achado do revisor): nome com UM ÚNICO ESPAÇO antes do '=' não passa mais " +
      "intacto — bypass documentado da defesa original, que só olhava a posição 0 crua",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
      listarLeadsMock.mockResolvedValue([leadFake({ contact: contactFake({ nome: " =1+1" }) })]);

      const resposta = await GET(requisicaoFake());
      const corpo = await resposta.text();
      const [, linhaDoLead] = corpo.split("\r\n");

      // Nunca solto sem prefixo — a linha não pode começar com o espaço
      // seguido direto do "=" sem o apóstrofo entre os dois:
      expect(linhaDoLead.startsWith(" =1+1")).toBe(false);
      // Neutralizado com apóstrofo à frente do valor ORIGINAL — o espaço
      // continua lá, só o apóstrofo entra antes dele:
      expect(linhaDoLead.startsWith("' =1+1")).toBe(true);
    }
  );

  it("um nome que genuinamente começa com espaço, mas SEM caractere perigoso na sequência, exporta com o espaço intacto — a defesa não apaga dado legítimo", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake({ contact: contactFake({ nome: " Ana Paula" }) })]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();
    const [, linhaDoLead] = corpo.split("\r\n");

    expect(linhaDoLead.startsWith(" Ana Paula")).toBe(true);
  });

  it("nome começando com tab (\\t) cru é neutralizado, mesmo sem '=' na sequência — conjunto de gatilho da OWASP", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "\tCarlos" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();
    const [, linhaDoLead] = corpo.split("\r\n");

    expect(linhaDoLead.startsWith("'\tCarlos")).toBe(true);
  });

  it("nome começando com retorno de carro (\\r) cru é neutralizado, mesmo sem '=' na sequência", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "\rCarlos" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    // O valor contém \r, então também cai na regra de quoting (item 4 da
    // suíte de escapaCampoCsv) — o apóstrofo entra ANTES do \r, dentro do
    // campo entre aspas.
    expect(corpo).toContain('"\'\rCarlos"');
  });
});

describe("GET /export/leads — escapaCampoCsv (aspas, ';', quebra de linha)", () => {
  it("nome com ';' (o delimitador desta exportação) é envolvido em aspas", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "Silva; Sobrenome" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain('"Silva; Sobrenome"');
  });

  it("nome com aspas duplas é escapado dobrando as aspas, dentro de um campo entre aspas", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: 'Nome "Apelido" Sobrenome' }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain('"Nome ""Apelido"" Sobrenome"');
  });

  it("nome com quebra de linha é envolvido em aspas (mantém 1 linha por lead no CSV final)", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "Linha1\nLinha2" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain('"Linha1\nLinha2"');
  });

  it("nome com ',' sozinho (não é o delimitador desta exportação) NÃO precisa de aspas", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "Silva, Sobrenome" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();

    expect(corpo).toContain("Silva, Sobrenome;(11) 99999-0000");
  });
});

// --- Fase 2 da auditoria de segurança -------------------------------------
//
// Achado: esta rota é o ÚNICO caminho do sistema desenhado para extrair a base
// inteira de clientes (nome + telefone de todo lead) num arquivo só, e não
// deixava rastro nenhum. A permissão (`exportar_leads`, ADMIN/GESTOR) diz QUEM
// pode; nada dizia QUE aconteceu. Uma sessão roubada de gestor, ou um insider
// de saída, levava a base completa sem produzir uma linha sequer para alguém
// investigar depois — e é justamente a extração em massa de dado pessoal que
// mais importa poder reconstituir.
//
// Auditoria e limite atacam coisas diferentes, de propósito: o log torna a
// extração VISÍVEL (é o controle que responde à sabotagem), o limite bota
// TETO no volume. Nenhum dos dois substitui o outro.
describe("GET /export/leads — auditoria da extração em massa", () => {
  it("exportação bem-sucedida grava quem exportou, de qual IP e QUANTOS registros saíram", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "gestor-7", papel: "GESTOR" }));
    listarLeadsMock.mockResolvedValue([leadFake({ id: "lead-1" }), leadFake({ id: "lead-2" })]);

    const resposta = await GET(requisicaoFake("198.51.100.20"));

    expect(resposta.status).toBe(200);
    expect(registrarAuditoriaMock).toHaveBeenCalledTimes(1);
    expect(registrarAuditoriaMock).toHaveBeenCalledWith({
      userId: "gestor-7",
      acao: "exportar_leads",
      entidade: "Lead",
      entidadeId: "todos",
      depois: { totalLeads: 2 },
      ip: "198.51.100.20",
    });
  });

  it("401 (sem sessão) não grava auditoria nem consome cota — não houve exportação para registrar", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(401);
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
    expect(checarRateLimitMock).not.toHaveBeenCalled();
  });

  it("403 (VENDEDOR, sem exportar_leads) não grava auditoria nem consome cota", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(403);
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
    expect(checarRateLimitMock).not.toHaveBeenCalled();
  });

  // Fail-closed, e é uma decisão, não um descuido: o controle existe para que
  // nenhuma extração em massa de dado pessoal saia sem rastro. Entregar o CSV
  // quando a gravação do log falhou reabriria exatamente o buraco que ele veio
  // fechar — e, na prática, se o log não grava é porque o banco de onde os
  // leads acabaram de ser lidos está em apuros de qualquer jeito.
  it("auditoria que falha derruba a exportação: 500, e nenhum dado de cliente no corpo", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ contact: contactFake({ nome: "Maria Sigilosa" }) }),
    ]);
    registrarAuditoriaMock.mockRejectedValue(new Error("banco indisponível"));

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(500);
    expect(await resposta.text()).not.toContain("Maria Sigilosa");
  });
});

describe("GET /export/leads — limite de taxa por conta", () => {
  it("a chave da cota carrega o id do usuário, com o limite e a janela da política", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "admin-9", papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake()]);

    await GET(requisicaoFake());

    expect(checarRateLimitMock).toHaveBeenCalledWith(
      "export:leads:admin-9",
      LIMITE_EXPORT_POR_CONTA,
      JANELA_EXPORT_MS
    );
  });

  it("cota estourada: 429, sem ler lead nenhum do banco e sem gravar auditoria", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    checarRateLimitMock.mockResolvedValue(false);

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(429);
    expect(listarLeadsMock).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  // O limite roda DEPOIS da autorização (provado pelos dois testes de 401/403
  // acima, que exigem `checarRateLimit` não chamado) e ANTES da consulta: uma
  // requisição barrada não pode custar a leitura da base inteira, senão o
  // controle que existe para conter abuso paga o preço do abuso.
  it("dentro da cota, a consulta acontece e o CSV é entregue", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([leadFake()]);

    const resposta = await GET(requisicaoFake());

    expect(resposta.status).toBe(200);
    expect(listarLeadsMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /export/leads — múltiplos leads", () => {
  it("uma linha por lead, na ordem devolvida por listarLeads (a rota não reordena)", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
    listarLeadsMock.mockResolvedValue([
      leadFake({ id: "lead-1", contact: contactFake({ nome: "Primeiro" }) }),
      leadFake({ id: "lead-2", contact: contactFake({ nome: "Segundo" }) }),
    ]);

    const resposta = await GET(requisicaoFake());
    const corpo = await resposta.text();
    const linhas = corpo.split("\r\n");

    expect(linhas).toHaveLength(3); // cabeçalho + 2 leads
    expect(linhas[1].startsWith("Primeiro")).toBe(true);
    expect(linhas[2].startsWith("Segundo")).toBe(true);
  });
});
