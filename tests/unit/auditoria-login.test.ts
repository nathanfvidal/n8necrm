// A porta de entrada deixa rastro — contra o Postgres de verdade.
//
// ## Por que banco real, e não mock
//
// O achado (item 39 da auditoria de 2026-08-21) é sobre uma tabela cujas duas
// colunas de identidade são hostis a este caso: `AuditLog.userId` é FK
// OBRIGATÓRIA para `User` e `AuditLog.companyId` é `NOT NULL`. Um mock com a
// forma do delegate do Prisma fica verde recebendo `companyId: undefined` — a
// armadilha está medida e escrita em `tests/unit/escopo-empresa.test.ts` e
// custou uma correção inteira nesta branch. Só o banco reprova isso.
//
// Aqui o que se prova é o que a linha REALMENTE tem depois de gravada: ação,
// entidade, IP, e — o mais importante — que `antes` e `depois` estão NULOS.
//
// ## O que NÃO está aqui
//
// O caminho de `autorizarCredenciais` (login aceito, login recusado, e a
// simetria entre conta existente e inexistente) mora em
// `tests/unit/login-seguranca.test.ts`, que já mocka o Prisma inteiro para
// medir ORDEM de chamada. Os dois arquivos não podem ser um só: aquele
// substitui `@/lib/prisma` por um objeto de mentira, e este precisa do
// Postgres.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next aplica no build — fora dele lança na importação.
// Mesmo mock de `tests/unit/audit-log.test.ts`.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import {
  ACAO_LOGIN,
  ACAO_LOGOUT,
  PREFIXO_TENTATIVA_RECUSADA,
  auditarLogin,
  auditarLogout,
  registrarTentativaRecusada,
} from "../../src/core/auth/auditoria-login";

describe("auditarLogin / auditarLogout", () => {
  let userId: string;
  let companyId: string;

  beforeAll(async () => {
    const empresa = await prisma.company.create({
      data: { nome: "Empresa de teste (auditoria de login)" },
    });
    companyId = empresa.id;

    // O vínculo é criado junto porque desde o Ciclo 1a ele é exigido — a
    // fixture sem `Membership` foi o que quebrou 17 casos em `e67e1e6`.
    const usuario = await prisma.user.create({
      data: {
        nome: "Usuário de teste (auditoria de login)",
        email: "teste-auditoria-login@teste.local",
        senhaHash: "hash-fake-nao-usado-em-login",
        memberships: { create: { companyId, papel: "VENDEDOR" } },
      },
    });
    userId = usuario.id;
  });

  // Ordem obrigatória das FKs, e `Notification` antes de `User` mesmo sem
  // nenhuma notificação esperada aqui: `Notification.userId` é RESTRICT, e uma
  // linha sobrando de um alerta de rajada travaria o `delete` do usuário —
  // deixando empresa e usuário órfãos no banco de desenvolvimento
  // COMPARTILHADO, e quebrando a execução seguinte no e-mail fixo do
  // `beforeAll`. Mesmo raciocínio de `audit-log.test.ts` e `63cecd2`.
  //
  // `afterAll` e não `finally`: `finally` não roda quando o caso morre por
  // timeout, que é exatamente quando a fixture fica para trás.
  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.membership.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
  });

  it("grava a linha de login com o par conta/IP/instante que faltava", async () => {
    await auditarLogin({ userId, companyId, ip: "203.0.113.10" });

    const linhas = await prisma.auditLog.findMany({ where: { userId } });
    expect(linhas).toHaveLength(1);

    const linha = linhas[0]!;
    expect(linha.acao).toBe(ACAO_LOGIN);
    expect(linha.companyId).toBe(companyId);
    expect(linha.entidade).toBe("User");
    expect(linha.entidadeId).toBe(userId);
    expect(linha.ip).toBe("203.0.113.10");
    // A pergunta do achado — "quem entrou nessa conta, de onde, e quando" —
    // precisa do INSTANTE, e ele vem do `@default(now())` da tabela.
    expect(linha.criadoEm.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("NÃO grava antes/depois — não há nada aqui que seja seguro guardar", async () => {
    // O precedente literal é `redefinirSenha` (`core/users/service.ts`), que
    // audita sem os dois pelo mesmo motivo. Num evento de login o único dado
    // além do identificador é a SENHA TENTADA: em claro é óbvio, em hash é um
    // oráculo offline pronto, e até o TAMANHO reduz o espaço de busca.
    //
    // A asserção é sobre a coluna LIDA DE VOLTA, e não sobre o argumento
    // passado: o Vitest ignora chave de valor `undefined` até em
    // `toHaveBeenCalledWith` exato, então um mock ficaria verde com o campo
    // presente. O banco não mente.
    await auditarLogin({ userId, companyId, ip: "203.0.113.11" });
    await auditarLogout({ userId, companyId, ip: "203.0.113.11" });

    const linhas = await prisma.auditLog.findMany({ where: { userId } });
    expect(linhas).toHaveLength(2);
    for (const linha of linhas) {
      expect(linha.antes).toBeNull();
      expect(linha.depois).toBeNull();
    }
  });

  it("logout grava a própria ação, distinguível do login", async () => {
    await auditarLogout({ userId, companyId, ip: "203.0.113.12" });

    const linha = await prisma.auditLog.findFirstOrThrow({ where: { userId } });
    expect(linha.acao).toBe(ACAO_LOGOUT);
    expect(ACAO_LOGOUT).not.toBe(ACAO_LOGIN);
  });

  it("sem IP, a coluna fica NULA em vez de receber sentinela", async () => {
    // Fora de um escopo de requisição — e um teste é isso — `headers()` lança e
    // `ipDaRequisicaoAtual()` devolve `undefined`. A coluna anulável guarda a
    // ausência como ausência: uma string `"desconhecido"` gravada N vezes
    // ficaria indistinguível de um IP que a borda não mandou.
    await auditarLogin({ userId, companyId });

    const linha = await prisma.auditLog.findFirstOrThrow({ where: { userId } });
    expect(linha.ip).toBeNull();
  });

  it("falha ao gravar NÃO derruba quem está entrando ou saindo", async () => {
    // Fail-open aqui, ao contrário da exportação de leads (fail-closed). Lá o
    // log ERA o controle; aqui, derrubar o login por causa do rastro vira
    // negação de serviço, e derrubar o LOGOUT ressuscitaria o defeito do
    // AGENTS.md pela mão da própria correção.
    //
    // `companyId` inexistente viola a FK de `Company` — erro de banco de
    // verdade, não um `throw` fabricado.
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      auditarLogout({ userId, companyId: "empresa-que-nao-existe" })
    ).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalled();

    erro.mockRestore();
  });
});

describe("registrarTentativaRecusada", () => {
  it("escreve a linha com conta, IP e motivo — e o prefixo estável da busca", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    registrarTentativaRecusada({
      email: "alguem@exemplo.com",
      ip: "203.0.113.20",
      conta: "existente",
      motivo: "credenciais",
    });

    const linha = aviso.mock.calls[0]![0] as string;
    expect(linha.startsWith(PREFIXO_TENTATIVA_RECUSADA)).toBe(true);
    expect(linha).toContain("email=alguem@exemplo.com");
    expect(linha).toContain("ip=203.0.113.20");
    expect(linha).toContain("conta=existente");
    expect(linha).toContain("motivo=credenciais");

    aviso.mockRestore();
  });

  it("quebra de linha no e-mail NÃO forja uma segunda linha de log", () => {
    // O e-mail vem do corpo de um POST público e não autenticado. Sem sanear,
    // `\n[auditoria] login recusado ...` planta uma linha inteira inventada
    // dentro do arquivo em que alguém vai procurar a verdade depois — e o
    // prefixo estável, que existe para facilitar a busca, é justamente o que a
    // torna convincente.
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    registrarTentativaRecusada({
      email: `vitima@exemplo.com\n${PREFIXO_TENTATIVA_RECUSADA} email=falso@exemplo.com`,
      ip: "203.0.113.21",
      conta: "inexistente",
      motivo: "credenciais",
    });

    const linha = aviso.mock.calls[0]![0] as string;
    expect(linha).not.toContain("\n");
    expect(linha).not.toContain("\r");
    // O prefixo aparece UMA vez: a do começo, que é a legítima.
    expect(linha.split(PREFIXO_TENTATIVA_RECUSADA)).toHaveLength(2);

    aviso.mockRestore();
  });

  it("o hífen sobrevive — a metade que impede a sanitização de virar dano", () => {
    // Sem este caso, `[\s -]` passa: parece uma classe de espaço e controle e
    // casa o hífen LITERAL, porque o `-` colado no `]` não abre faixa nenhuma.
    // O resultado é `e2e-admin@teste.invalid` virando `e2e·admin@teste.invalid`
    // e sumindo de qualquer busca por e-mail — a linha continua existindo e
    // deixa de servir para a única coisa que ela faz.
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    registrarTentativaRecusada({
      email: "e2e-admin@teste.invalid",
      ip: "203.0.113.22",
      conta: "existente",
      motivo: "limite",
    });

    expect(aviso.mock.calls[0]![0] as string).toContain("email=e2e-admin@teste.invalid");

    aviso.mockRestore();
  });

  it("e-mail gigante não define o tamanho da linha", () => {
    // Mesmo corte de `chaveDaConta` (`core/rate-limit/login.ts`), e pelo mesmo
    // motivo: o corpo do POST de login é público, e um "e-mail" de 10 KB por
    // requisição é um jeito barato de encher o log de quem está de plantão.
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    registrarTentativaRecusada({
      email: "a".repeat(10_000),
      ip: "203.0.113.23",
      conta: "inexistente",
      motivo: "credenciais",
    });

    const linha = aviso.mock.calls[0]![0] as string;
    expect(linha).toContain(`email=${"a".repeat(200)} `);
    expect(linha).not.toContain("a".repeat(201));

    aviso.mockRestore();
  });
});

/**
 * `ipDaRequisicaoAtual()` — o sub-achado do item 39.
 *
 * `AuditLog.ip` estava preenchido em **1 dos 23 pontos**, e a causa é
 * estrutural: 22 nascem em Server Action, e Server Action não recebe `Request`.
 * `headers()` de `next/headers` é a única porta, e estes casos travam a ordem
 * de precedência dela — que é decisão de segurança, não detalhe.
 *
 * O módulo é importado DEPOIS do `vi.doMock` em cada caso, e não no topo: um
 * `vi.mock` içado valeria para o arquivo inteiro, e o caso do "fora de
 * requisição" precisa justamente do `next/headers` de verdade lançando.
 */
describe("ipDaRequisicaoAtual", () => {
  const cabecalhoOriginal = process.env.IP_CABECALHO_CONFIAVEL;

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("next/headers");
    // A variável é lida DENTRO da função (leitura preguiçosa), então cada caso
    // a define ou a apaga por conta própria e este `afterEach` devolve o
    // ambiente ao que era — senão a ordem dos casos passaria a decidir o
    // resultado deles.
    if (cabecalhoOriginal === undefined) delete process.env.IP_CABECALHO_CONFIAVEL;
    else process.env.IP_CABECALHO_CONFIAVEL = cabecalhoOriginal;
  });

  async function comCabecalhos(pares: Record<string, string>) {
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers(pares),
    }));
    vi.resetModules();
    const { ipDaRequisicaoAtual } = await import("../../src/lib/ip");
    return ipDaRequisicaoAtual();
  }

  it("sem IP_CABECALHO_CONFIAVEL, NENHUM cabeçalho vira IP", async () => {
    // `x-vercel-forwarded-for` funcionava por uma propriedade da plataforma: ela
    // SOBRESCREVIA o que viesse de fora com aquele nome. Fora da Vercel sobram
    // `x-real-ip` e `x-forwarded-for`, e os dois são escolhidos pelo cliente
    // quando não há proxy confiável na frente. Continuar lendo-os seria trocar
    // um cabeçalho não forjável por um forjável SEM mudar uma linha de
    // comentário — o pior desfecho, porque o código seguiria afirmando uma
    // garantia que perdeu.
    delete process.env.IP_CABECALHO_CONFIAVEL;
    expect(
      await comCabecalhos({
        "x-forwarded-for": "198.51.100.9",
        "x-real-ip": "203.0.113.60",
        "x-vercel-forwarded-for": "203.0.113.55",
      })
    ).toBeUndefined();
  });

  it("com IP_CABECALHO_CONFIAVEL definida, SÓ o cabeçalho nomeado é lido", async () => {
    process.env.IP_CABECALHO_CONFIAVEL = "x-real-ip";
    expect(
      await comCabecalhos({
        "x-real-ip": "203.0.113.60",
        "x-forwarded-for": "198.51.100.9",
      })
    ).toBe("203.0.113.60");
  });

  it("o cabeçalho nomeado que chega ausente NÃO cai para outro", async () => {
    // Sem fallback: uma borda que devia sobrescrever `cf-connecting-ip` e não
    // mandou nada é uma borda que não está na frente. Cair para o que o cliente
    // mandou seria transformar a falha de configuração em IP forjado.
    process.env.IP_CABECALHO_CONFIAVEL = "cf-connecting-ip";
    expect(await comCabecalhos({ "x-forwarded-for": "198.51.100.9" })).toBeUndefined();
  });

  it("pega o primeiro da lista quando a borda manda vários", async () => {
    process.env.IP_CABECALHO_CONFIAVEL = "x-vercel-forwarded-for";
    expect(
      await comCabecalhos({ "x-vercel-forwarded-for": "203.0.113.70, 10.0.0.1, 10.0.0.2" })
    ).toBe("203.0.113.70");
  });

  it("o nome do cabeçalho é comparado sem caixa e sem espaços nas pontas", async () => {
    // Nome de cabeçalho HTTP é insensível a caixa (RFC 9110 §5.1), e a variável
    // é digitada por uma pessoa num painel de hospedagem. `Headers.get` já
    // normaliza a caixa do lado dele; o `trim()` é o que impede que um espaço
    // colado junto silencie o IP inteiro — falha que não deixaria rastro
    // nenhum, porque o estado sem IP é justamente o estado válido.
    process.env.IP_CABECALHO_CONFIAVEL = "  X-Real-IP  ";
    expect(await comCabecalhos({ "x-real-ip": "203.0.113.60" })).toBe("203.0.113.60");
  });

  it("fora de um escopo de requisição devolve `undefined`, e NÃO lança", async () => {
    // Job de fila, seed, script e este próprio teste. Auditoria que derruba a
    // operação que ela deveria apenas registrar é pior que auditoria sem IP.
    // `undefined` e não `IP_DESCONHECIDO`: a coluna é anulável, e uma sentinela
    // gravada 22 vezes ficaria indistinguível de um IP que a borda não mandou.
    //
    // A variável é definida DE PROPÓSITO: sem ela a função devolveria
    // `undefined` antes de chegar em `headers()`, e o caso ficaria verde sem
    // nunca exercitar o `try/catch` que ele existe para provar.
    process.env.IP_CABECALHO_CONFIAVEL = "x-real-ip";
    vi.resetModules();
    const { ipDaRequisicaoAtual } = await import("../../src/lib/ip");
    await expect(ipDaRequisicaoAtual()).resolves.toBeUndefined();
  });

  it("o IP que o chamador informou NUNCA é sobrescrito pelo ambiente", async () => {
    // A precedência é do chamador: a exportação de leads lê o IP do `Request`
    // real do route handler, e o login lê o `Request` que o @auth/core
    // reconstrói. As duas fontes são melhores que a ambiente.
    //
    // A variável nomeia o cabeçalho porque a SEGUNDA metade do caso — a que
    // prova que o preenchimento automático de fato roda — só tem desfecho
    // observável quando existe uma borda em que confiar.
    process.env.IP_CABECALHO_CONFIAVEL = "x-vercel-forwarded-for";
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers({ "x-vercel-forwarded-for": "203.0.113.80" }),
    }));
    vi.resetModules();

    const { prisma: prismaLocal } = await import("../../src/lib/prisma");
    const { gravarLinhaDeAuditoria } = await import("../../src/core/audit/log");

    const empresa = await prismaLocal.company.create({
      data: { nome: "Empresa de teste (precedencia de ip)" },
    });
    const usuario = await prismaLocal.user.create({
      data: {
        nome: "Usuário de teste (precedencia de ip)",
        email: "teste-precedencia-ip@teste.local",
        senhaHash: "hash-fake-nao-usado-em-login",
        memberships: { create: { companyId: empresa.id, papel: "VENDEDOR" } },
      },
    });

    try {
      await gravarLinhaDeAuditoria({
        companyId: empresa.id,
        userId: usuario.id,
        acao: "login",
        entidade: "User",
        entidadeId: usuario.id,
        ip: "203.0.113.81",
      });

      const linha = await prismaLocal.auditLog.findFirstOrThrow({
        where: { userId: usuario.id },
      });
      expect(linha.ip).toBe("203.0.113.81");

      // E a outra metade: SEM `ip` informado, o ambiente preenche. Sem esta
      // asserção, "a precedência do chamador funciona" também seria verdade
      // num mundo em que o preenchimento automático nunca roda.
      await gravarLinhaDeAuditoria({
        companyId: empresa.id,
        userId: usuario.id,
        acao: "logout",
        entidade: "User",
        entidadeId: usuario.id,
      });

      const doAmbiente = await prismaLocal.auditLog.findFirstOrThrow({
        where: { userId: usuario.id, acao: "logout" },
      });
      expect(doAmbiente.ip).toBe("203.0.113.80");
    } finally {
      // `finally` aqui e `afterAll` no bloco de cima: este caso cria a própria
      // fixture e não há outro caso compartilhando, então a limpeza mora junto.
      // A ordem das FKs é a mesma — `Notification` não existe neste caminho.
      await prismaLocal.auditLog.deleteMany({ where: { userId: usuario.id } });
      await prismaLocal.membership.deleteMany({ where: { userId: usuario.id } });
      await prismaLocal.user.deleteMany({ where: { id: usuario.id } });
      await prismaLocal.company.deleteMany({ where: { id: empresa.id } });
    }
  });
});
