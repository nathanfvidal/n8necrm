import { describe, it, expect, vi, beforeEach } from "vitest";

// `registrarAuditoria` (`core/audit/log.ts`) passou a importar
// `core/audit/alerta.ts` para a detecção de rajada destrutiva, e aquele
// módulo tem `import "server-only"` — que sempre lança fora do pipeline de
// build do Next (ver `tests/unit/storage.test.ts`, onde este mock foi
// documentado pela primeira vez). O `users/service.ts` testado aqui chama
// `registrarAuditoria`, então sem este mock o arquivo inteiro quebra na
// importação, não por causa da regra testada.
vi.mock("server-only", () => ({}));

/**
 * Proteção do último administrador ativo — o único estrago desta tela que não
 * tem volta pela interface: sem nenhum ADMIN ativo, ninguém consegue promover
 * ninguém, e só acesso direto ao banco desfaz.
 *
 * ## Por que "daquela empresa" e não do sistema inteiro
 *
 * Desde que o papel passou a viver em `Membership` (Ciclo 1a), a guarda
 * conta administradores DENTRO da empresa de quem está agindo — rebaixar o
 * último ADMIN da empresa A não pode ser recusado por causa da empresa B.
 * `COMPANY_ID` abaixo é o escopo fixo usado em todo este arquivo.
 *
 * ## Por que este arquivo mocka o Prisma, enquanto `users-service.test.ts` usa
 * o banco de verdade
 *
 * A guarda pergunta "existe outro administrador ativo NESTA empresa?", e no
 * Postgres compartilhado a resposta seria sempre "sim", porque
 * `admin@exemplo.com` existe — então o caminho de REJEIÇÃO só seria alcançável
 * desativando ou rebaixando o administrador de verdade.
 *
 * Isso é inaceitável neste projeto: o banco é o mesmo que a aplicação usa, com
 * dado real. Uma suíte morta no meio da janela de restauração deixaria o
 * sistema sem administrador ativo — e o `prisma/seed.ts` não conserta, porque
 * o upsert de `User` não regrava `ativo`. É a mesma classe de armadilha que a
 * rotação de senha do `seed.test.ts` já produziu, só que sem cura.
 *
 * Com o Prisma mockado, a contagem é um valor de teste e nada é escrito. O que
 * este arquivo prova é a DECISÃO e a forma da consulta; o que a consulta
 * devolve contra dado real é problema do banco, não da regra.
 */

const db = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  membership: {
    count: vi.fn(),
    update: vi.fn(),
    // `registrarAuditoria()` (chamada por `atualizarUsuario`/`definirAtivo`
    // no fim de cada caminho feliz) resolve a empresa de quem agiu via
    // `companyIdDoUsuario()` (`core/users/empresa.ts`), que consulta
    // `membership.findFirstOrThrow` — infraestrutura de outra tarefa
    // (companyId em AuditLog), não algo que este arquivo decide, mas que
    // precisa de mock para o mock de `$transaction`/`auditLog.create` não
    // travar num `TypeError` no meio dos testes que chegam até lá.
    findFirstOrThrow: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  // Estilo callback ($transaction(async (tx) => ...)), o mesmo que
  // `criarUsuario`/`atualizarUsuario` usam de verdade — o mock só passa o
  // próprio `db` como `tx`, então as chamadas dentro da transação caem nos
  // MESMOS mocks acima.
  $transaction: vi.fn((cb: (tx: typeof db) => unknown) => cb(db)),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { atualizarUsuario, definirAtivo, UsuarioInvalidoError } = await import("@/core/users/service");
const { ID_SISTEMA_WHATSAPP } = await import("@/core/users/sistema");

const COMPANY_ID = "empresa-teste-ultimo-admin";
const ADMIN_ALVO = {
  id: "admin-alvo",
  nome: "Admin Alvo",
  email: "alvo@exemplo.com",
  ativo: true,
  // `papel` chega aqui como o `Membership` filtrado por `companyId` que
  // `atualizarUsuario`/`definirAtivo` buscam junto do `User` — é o que essas
  // funções LEEM para decidir. (`User.papel` também existe no banco, como
  // bridge de escrita para leitores fora do escopo desta tarefa — ver
  // `core/users/service.ts` — mas ninguém aqui dentro volta a LER de lá.)
  memberships: [{ papel: "ADMIN" }],
};
const AUTOR = "outro-admin";

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));
  db.membership.findFirstOrThrow.mockResolvedValue({ companyId: COMPANY_ID });
  db.user.findUnique.mockResolvedValue(ADMIN_ALVO);
  db.user.update.mockResolvedValue({
    id: ADMIN_ALVO.id,
    nome: ADMIN_ALVO.nome,
    email: ADMIN_ALVO.email,
    ativo: false,
    criadoEm: new Date(),
  });
  db.membership.update.mockResolvedValue({});
  db.auditLog.create.mockResolvedValue({});
});

describe("proteção do último administrador ativo", () => {
  it("recusa desativar o último ADMIN, e não chega a escrever", async () => {
    db.membership.count.mockResolvedValue(0);

    await expect(definirAtivo({ id: ADMIN_ALVO.id, ativo: false }, AUTOR, COMPANY_ID)).rejects.toThrow(
      UsuarioInvalidoError
    );

    // A asserção que importa: a recusa acontece ANTES da escrita. Um guarda
    // que lançasse depois do `update` deixaria o sistema sem administrador e
    // ainda por cima devolveria erro — o pior dos dois mundos.
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("permite desativar um ADMIN quando sobra outro NA MESMA EMPRESA", async () => {
    db.membership.count.mockResolvedValue(1);

    await definirAtivo({ id: ADMIN_ALVO.id, ativo: false }, AUTOR, COMPANY_ID);

    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it("recusa rebaixar o último ADMIN — o outro caminho para o mesmo fim", async () => {
    db.membership.count.mockResolvedValue(0);

    await expect(
      atualizarUsuario({ id: ADMIN_ALVO.id, nome: "Admin Alvo", papel: "VENDEDOR" }, AUTOR, COMPANY_ID)
    ).rejects.toThrow(/último administrador ativo/);

    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("não conta o próprio alvo nem contas de sistema, e escopa por companyId", async () => {
    db.membership.count.mockResolvedValue(1);

    await definirAtivo({ id: ADMIN_ALVO.id, ativo: false }, AUTOR, COMPANY_ID);

    // A forma da consulta é o que o bug do spread quebrava silenciosamente
    // (ver `core/users/sistema.ts`): os dois predicados de `userId` precisam
    // conviver no MESMO objeto. Se alguém voltar a espalhar um fragmento, o
    // `not` some e a contagem passa a incluir o próprio alvo — a guarda
    // deixaria de disparar exatamente quando deveria. `companyId` é o que
    // torna a guarda "daquela empresa", não do sistema inteiro.
    expect(db.membership.count).toHaveBeenCalledWith({
      where: {
        companyId: COMPANY_ID,
        papel: "ADMIN",
        userId: { not: ADMIN_ALVO.id, notIn: [ID_SISTEMA_WHATSAPP] },
        user: { ativo: true },
      },
    });
  });

  it("não consulta a guarda ao REATIVAR alguém — reativar nunca tira administrador", async () => {
    db.user.findUnique.mockResolvedValue({ ...ADMIN_ALVO, ativo: false });

    await definirAtivo({ id: ADMIN_ALVO.id, ativo: true }, AUTOR, COMPANY_ID);

    expect(db.membership.count).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it("não consulta a guarda ao editar um ADMIN que continua ADMIN", async () => {
    await atualizarUsuario({ id: ADMIN_ALVO.id, nome: "Nome Novo", papel: "ADMIN" }, AUTOR, COMPANY_ID);

    expect(db.membership.count).not.toHaveBeenCalled();
  });

  it("não consulta a guarda ao desativar quem não é ADMIN", async () => {
    db.user.findUnique.mockResolvedValue({ ...ADMIN_ALVO, memberships: [{ papel: "VENDEDOR" }] });

    await definirAtivo({ id: ADMIN_ALVO.id, ativo: false }, AUTOR, COMPANY_ID);

    expect(db.membership.count).not.toHaveBeenCalled();
  });
});
