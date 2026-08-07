// Toca o Postgres real (mesmo padrão de audit-log.test.ts e rate-limit.test.ts),
// então carrega DATABASE_URL do .env aqui — não em vitest.config.ts — para não
// injetar credenciais em testes que não tocam banco. Precisa ser o primeiro
// import: src/lib/prisma.ts → src/lib/env.ts lê process.env.DATABASE_URL no
// top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" sempre lança fora do pipeline de build do Next (a condição de
// resolução "react-server" é que o transforma em no-op). `src/lib/prisma.ts` o
// importa, e este arquivo importa `prisma` direto.
vi.mock("server-only", () => ({}));

import bcrypt from "bcryptjs";

import { prisma } from "../../src/lib/prisma";
import {
  atualizarUsuario,
  criarUsuario,
  definirAtivo,
  redefinirSenha,
  UsuarioInvalidoError,
} from "../../src/core/users/service";
import { buscarUsuario, listarUsuarios } from "../../src/core/users/queries";
import { ID_SISTEMA_WHATSAPP } from "../../src/core/users/sistema";

// Prefixo único deste arquivo. A limpeza do `afterAll` apaga POR ELE, e não
// por algo mais largo: o banco é compartilhado com dados reais, e um
// `deleteMany` amplo aqui apagaria gente de verdade.
const PREFIXO = "teste-users-service-";
const email = (sufixo: string) => `${PREFIXO}${sufixo}@teste.local`;

describe("core/users — service", () => {
  let autorId: string;

  beforeAll(async () => {
    // Autor das ações: `AuditLog.userId` é FK obrigatória, então precisa ser
    // um usuário real. ADMIN porque é o papel que o serviço espera de quem
    // chama (a permissão em si é checada na action, não aqui).
    const autor = await prisma.user.create({
      data: {
        nome: "Autor de teste (users service)",
        email: email("autor"),
        senhaHash: "hash-fake-nao-usado-em-login",
        papel: "ADMIN",
      },
    });
    autorId = autor.id;
  });

  afterAll(async () => {
    // Ordem importa: `AuditLog.userId` é RESTRICT, então os registros de
    // auditoria saem antes dos usuários que eles referenciam.
    await prisma.auditLog.deleteMany({ where: { userId: autorId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  });

  describe("criarUsuario", () => {
    it("cria a pessoa e NUNCA devolve senhaHash", async () => {
      const criado = await criarUsuario(
        { nome: "Maria Vendedora", email: email("maria"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId
      );

      expect(criado.nome).toBe("Maria Vendedora");
      expect(criado.papel).toBe("VENDEDOR");
      expect(criado.ativo).toBe(true);

      // A asserção central desta fatia, e ela é sobre AUSÊNCIA — por isso é
      // explícita em vez de implícita num `toEqual`: o vazamento de
      // `senhaHash` acontece por omissão (um `select` esquecido, um `include`
      // ingênuo), e um teste que só confere os campos presentes passaria
      // felizmente com o hash junto.
      expect(Object.keys(criado)).not.toContain("senhaHash");
      expect(criado).not.toHaveProperty("senhaHash");
    });

    it("normaliza o e-mail para minúsculas, senão o login não encontra quem se cadastrou", async () => {
      const criado = await criarUsuario(
        { nome: "João Gestor", email: email("JOAO").toUpperCase(), papel: "GESTOR", senha: "senha-de-teste" },
        autorId
      );

      expect(criado.email).toBe(email("joao"));
    });

    it("grava a senha com bcrypt de custo 10, o mesmo do hash inerte que defende o login", async () => {
      const criado = await criarUsuario(
        { nome: "Custo Bcrypt", email: email("custo"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId
      );

      const { senhaHash } = await prisma.user.findUniqueOrThrow({
        where: { id: criado.id },
        select: { senhaHash: true },
      });

      // `core/auth/credenciais.ts` compara contra um hash inerte de custo 10
      // quando o e-mail não existe, para que "não existe" e "senha errada"
      // levem o mesmo tempo. Custo diferente aqui devolveria a enumeração de
      // usuário por cronometragem que aquele código fechou.
      expect(senhaHash.startsWith("$2b$10$")).toBe(true);
      expect(await bcrypt.compare("senha-de-teste", senhaHash)).toBe(true);
    });

    it("registra auditoria sem o hash da senha", async () => {
      const criado = await criarUsuario(
        { nome: "Auditado", email: email("auditado"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId
      );

      const log = await prisma.auditLog.findFirst({
        where: { userId: autorId, entidade: "User", entidadeId: criado.id, acao: "criar_usuario" },
      });

      expect(log).not.toBeNull();
      // `AuditLog.depois` é lido pelo dashboard e por qualquer consulta futura
      // ao histórico. O hash não pode escapar da única coluna que deveria
      // contê-lo.
      expect(JSON.stringify(log?.depois)).not.toContain("$2b$");
      expect(log?.depois).toEqual({
        nome: "Auditado",
        email: email("auditado"),
        papel: "VENDEDOR",
        ativo: true,
      });
    });

    it("recusa e-mail já cadastrado com mensagem tratada, não com erro cru do banco", async () => {
      await criarUsuario(
        { nome: "Primeiro", email: email("duplicado"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId
      );

      await expect(
        criarUsuario(
          { nome: "Segundo", email: email("duplicado"), papel: "VENDEDOR", senha: "senha-de-teste" },
          autorId
        )
      ).rejects.toThrow(UsuarioInvalidoError);
    });

    it("recusa senha curta demais", async () => {
      await expect(
        criarUsuario(
          { nome: "Senha Curta", email: email("curta"), papel: "VENDEDOR", senha: "1234567" },
          autorId
        )
      ).rejects.toThrow(/pelo menos 8 caracteres/);
    });

    it("recusa senha acima de 72 bytes, que o bcrypt truncaria em silêncio", async () => {
      // Sem este teto, esta senha e os seus 72 primeiros bytes autenticariam
      // a mesma conta — o bcrypt descarta o excedente sem avisar ninguém.
      await expect(
        criarUsuario(
          { nome: "Senha Longa", email: email("longa"), papel: "VENDEDOR", senha: "a".repeat(73) },
          autorId
        )
      ).rejects.toThrow(/72 bytes/);
    });

    it("conta bytes e não caracteres no teto da senha", async () => {
      // 40 emojis = 160 bytes em UTF-8, mas só 80 unidades de código em JS.
      // É o byte que o bcrypt conta.
      await expect(
        criarUsuario(
          { nome: "Emoji", email: email("emoji"), papel: "VENDEDOR", senha: "🔒".repeat(40) },
          autorId
        )
      ).rejects.toThrow(/72 bytes/);
    });

    it("recusa papel que não existe, mesmo vindo de fora do TypeScript", async () => {
      await expect(
        criarUsuario(
          // O tipo `Role` não vale nada contra um POST montado à mão — daí o
          // cast, que reproduz exatamente o que chegaria pela Server Action.
          { nome: "Papel Falso", email: email("papel"), papel: "SUPERADMIN" as never, senha: "senha-de-teste" },
          autorId
        )
      ).rejects.toThrow(/Papel inválido/);
    });

    it("recusa nome vazio e e-mail malformado", async () => {
      await expect(
        criarUsuario({ nome: "   ", email: email("vazio"), papel: "VENDEDOR", senha: "senha-de-teste" }, autorId)
      ).rejects.toThrow(/nome é obrigatório/);

      await expect(
        criarUsuario({ nome: "Sem Arroba", email: "nao-e-email", papel: "VENDEDOR", senha: "senha-de-teste" }, autorId)
      ).rejects.toThrow(/E-mail inválido/);
    });
  });

  describe("desativação", () => {
    it("desativa e reativa, registrando auditoria dos dois lados", async () => {
      const alvo = await criarUsuario(
        { nome: "Vai e Volta", email: email("toggle"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId
      );

      const desativado = await definirAtivo({ id: alvo.id, ativo: false }, autorId);
      expect(desativado.ativo).toBe(false);

      const reativado = await definirAtivo({ id: alvo.id, ativo: true }, autorId);
      expect(reativado.ativo).toBe(true);

      const acoes = await prisma.auditLog.findMany({
        where: { userId: autorId, entidade: "User", entidadeId: alvo.id },
        select: { acao: true },
      });
      expect(acoes.map((a) => a.acao).sort()).toEqual(["ativar_usuario", "criar_usuario", "desativar_usuario"]);
    });

    it("não deixa alguém desativar a própria conta", async () => {
      await expect(definirAtivo({ id: autorId, ativo: false }, autorId)).rejects.toThrow(
        /não pode desativar a própria conta/
      );

      // E o banco não mudou — a recusa é antes da escrita, não um rollback.
      const autor = await prisma.user.findUniqueOrThrow({ where: { id: autorId }, select: { ativo: true } });
      expect(autor.ativo).toBe(true);
    });
  });

  describe("atualizarUsuario", () => {
    it("edita nome e papel, guardando antes e depois na auditoria", async () => {
      const alvo = await criarUsuario(
        { nome: "Nome Antigo", email: email("editar"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId
      );

      const depois = await atualizarUsuario({ id: alvo.id, nome: "Nome Novo", papel: "GESTOR" }, autorId);

      expect(depois.nome).toBe("Nome Novo");
      expect(depois.papel).toBe("GESTOR");
      expect(depois).not.toHaveProperty("senhaHash");

      const log = await prisma.auditLog.findFirst({
        where: { userId: autorId, entidadeId: alvo.id, acao: "editar_usuario" },
      });
      expect(log?.antes).toEqual({ nome: "Nome Antigo", papel: "VENDEDOR" });
      expect(log?.depois).toEqual({ nome: "Nome Novo", papel: "GESTOR" });
    });

    it("não deixa alguém mudar o próprio papel", async () => {
      await expect(
        atualizarUsuario({ id: autorId, nome: "Autor de teste (users service)", papel: "VENDEDOR" }, autorId)
      ).rejects.toThrow(/não pode mudar o próprio papel/);
    });

    it("deixa a pessoa editar o próprio nome, contanto que o papel não mude", async () => {
      const depois = await atualizarUsuario({ id: autorId, nome: "Autor Renomeado", papel: "ADMIN" }, autorId);
      expect(depois.nome).toBe("Autor Renomeado");
    });
  });

  describe("redefinirSenha", () => {
    it("troca o hash e a senha nova passa a valer", async () => {
      const alvo = await criarUsuario(
        { nome: "Esqueceu a Senha", email: email("senha"), papel: "VENDEDOR", senha: "senha-antiga" },
        autorId
      );

      await redefinirSenha({ id: alvo.id, senha: "senha-nova-valida" }, autorId);

      const { senhaHash } = await prisma.user.findUniqueOrThrow({
        where: { id: alvo.id },
        select: { senhaHash: true },
      });
      expect(await bcrypt.compare("senha-nova-valida", senhaHash)).toBe(true);
      expect(await bcrypt.compare("senha-antiga", senhaHash)).toBe(false);
    });

    it("não guarda nada da senha na auditoria", async () => {
      const alvo = await criarUsuario(
        { nome: "Auditoria de Senha", email: email("senha-audit"), papel: "VENDEDOR", senha: "senha-antiga" },
        autorId
      );

      await redefinirSenha({ id: alvo.id, senha: "outra-senha-valida" }, autorId);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { userId: autorId, entidadeId: alvo.id, acao: "redefinir_senha" },
      });
      expect(log.antes).toBeNull();
      expect(log.depois).toBeNull();
    });
  });

  describe("contas de sistema", () => {
    it("não aparecem na listagem da equipe", async () => {
      const usuarios = await listarUsuarios();
      expect(usuarios.map((u) => u.id)).not.toContain(ID_SISTEMA_WHATSAPP);
    });

    it("a listagem nunca traz senhaHash", async () => {
      const usuarios = await listarUsuarios();
      expect(usuarios.length).toBeGreaterThan(0);
      for (const usuario of usuarios) {
        expect(usuario).not.toHaveProperty("senhaHash");
      }
    });

    it("buscarUsuario devolve null para conta de sistema, como se não existisse", async () => {
      // A linha EXISTE no banco (o seed a cria) — o `null` é decisão, não
      // ausência de dado. Se este teste começar a falhar por a linha não
      // existir, o seed é que não rodou.
      const noBanco = await prisma.user.findUnique({ where: { id: ID_SISTEMA_WHATSAPP } });
      expect(noBanco).not.toBeNull();

      expect(await buscarUsuario(ID_SISTEMA_WHATSAPP)).toBeNull();
    });

    it("não podem ser editadas, desativadas nem ter a senha trocada", async () => {
      await expect(
        atualizarUsuario({ id: ID_SISTEMA_WHATSAPP, nome: "Sequestrado", papel: "ADMIN" }, autorId)
      ).rejects.toThrow(/conta é do sistema/);

      // Reativar o robô é o caso perigoso: ele é ADMIN e não consegue fazer
      // login, então passaria a contar como "administrador ativo" na proteção
      // do último ADMIN — e o sistema autorizaria desativar a última pessoa
      // de verdade.
      await expect(definirAtivo({ id: ID_SISTEMA_WHATSAPP, ativo: true }, autorId)).rejects.toThrow(
        /conta é do sistema/
      );

      await expect(
        redefinirSenha({ id: ID_SISTEMA_WHATSAPP, senha: "senha-de-teste" }, autorId)
      ).rejects.toThrow(/conta é do sistema/);

      const robo = await prisma.user.findUniqueOrThrow({ where: { id: ID_SISTEMA_WHATSAPP } });
      expect(robo.ativo).toBe(false);
      expect(robo.nome).toBe("Atendente WhatsApp (sistema)");
    });
  });
});
