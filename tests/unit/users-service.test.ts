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
  // A empresa de quem chama — desde que o papel passou a morar em
  // `Membership`, toda função deste módulo é escopada por `companyId`. Uma
  // `Company` própria para este arquivo, e não `company-migracao-1a` (a
  // empresa real de produção), pelo mesmo motivo do prefixo "teste-" no
  // e-mail: isolar este arquivo do dado de verdade e de qualquer outro teste.
  let companyId: string;

  beforeAll(async () => {
    const empresa = await prisma.company.create({ data: { nome: `${PREFIXO}empresa` } });
    companyId = empresa.id;

    // Autor das ações: `AuditLog.userId` é FK obrigatória, então precisa ser
    // um usuário real. Precisa TAMBÉM ter `Membership` ADMIN nesta empresa —
    // `atualizarUsuario`/`definirAtivo` buscam o vínculo do PRÓPRIO autor
    // quando `entrada.id === autorId` (os testes de "não pode mudar o
    // próprio papel" abaixo dependem disso), e sem vínculo eles veriam
    // "Usuário não encontrado" em vez da mensagem que estão provando.
    //
    // O papel vai SÓ para o `Membership` logo abaixo. A coluna espelho
    // `User.papel`, que este `create` direto também precisava preencher
    // enquanto ela fosse NOT NULL, deixou de ser escrita no Ciclo 1f — passou
    // a aceitar nulo em 21f0912 e `criarUsuario` parou de gravá-la em f6e6eea,
    // na mesma leva.
    const autor = await prisma.user.create({
      data: {
        nome: "Autor de teste (users service)",
        email: email("autor"),
        senhaHash: "hash-fake-nao-usado-em-login",
      },
    });
    autorId = autor.id;
    await prisma.membership.create({ data: { userId: autorId, companyId, papel: "ADMIN" } });
  });

  afterAll(async () => {
    // Ordem importa: `AuditLog.userId` e `Notification.userId` são RESTRICT,
    // então tudo que aponta para os usuários sai antes deles. `Membership`
    // não precisa de `deleteMany` à parte — cascade de `User` (onDelete:
    // Cascade em `Membership.userId`) já leva os vínculos junto.
    //
    // `Notification` entrou aqui depois de um estrago medido, não por
    // precaução: enquanto `marcarAguardandoHumano` notificava "todos os
    // ativos" sem empresa nenhuma, os usuários deste arquivo recebiam avisos
    // de conversas de OUTRA empresa; a FK `Notification_userId_fkey` barrava
    // o `deleteMany` abaixo, o arquivo deixava 11 usuários e 8 empresas para
    // trás, e TODA execução seguinte falhava no `beforeAll` por e-mail
    // duplicado — o e-mail é determinístico. Um banco de desenvolvimento
    // compartilhado se envenena de vez e o sintoma (`Unique constraint ...
    // email`) não aponta para a causa.
    //
    // Aquele vazamento foi corrigido, mas a fixture continuaria frágil sem
    // esta linha: qualquer notificação LEGÍTIMA futura para estes usuários
    // repete o quadro inteiro. O `afterAll` limpa o que o arquivo cria.
    const idsCriados = await prisma.user.findMany({
      where: { email: { startsWith: PREFIXO } },
      select: { id: true },
    });
    const ids = idsCriados.map((usuario) => usuario.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  describe("criarUsuario", () => {
    it("cria a pessoa e NUNCA devolve senhaHash", async () => {
      const criado = await criarUsuario(
        { nome: "Maria Vendedora", email: email("maria"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId,
        companyId
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

    it("cria o Membership na MESMA transação — um User sem vínculo é conta inutilizável", async () => {
      const criado = await criarUsuario(
        { nome: "Vínculo Junto", email: email("vinculo"), papel: "GESTOR", senha: "senha-de-teste" },
        autorId,
        companyId
      );

      const vinculo = await prisma.membership.findUniqueOrThrow({
        where: { userId_companyId: { userId: criado.id, companyId } },
      });
      expect(vinculo.papel).toBe("GESTOR");
    });

    it("normaliza o e-mail para minúsculas, senão o login não encontra quem se cadastrou", async () => {
      const criado = await criarUsuario(
        { nome: "João Gestor", email: email("JOAO").toUpperCase(), papel: "GESTOR", senha: "senha-de-teste" },
        autorId,
        companyId
      );

      expect(criado.email).toBe(email("joao"));
    });

    it("grava a senha com bcrypt de custo 10, o mesmo do hash inerte que defende o login", async () => {
      const criado = await criarUsuario(
        { nome: "Custo Bcrypt", email: email("custo"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId,
        companyId
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
        autorId,
        companyId
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
        autorId,
        companyId
      );

      await expect(
        criarUsuario(
          { nome: "Segundo", email: email("duplicado"), papel: "VENDEDOR", senha: "senha-de-teste" },
          autorId,
          companyId
        )
      ).rejects.toThrow(UsuarioInvalidoError);
    });

    it("recusa senha curta demais", async () => {
      await expect(
        criarUsuario(
          { nome: "Senha Curta", email: email("curta"), papel: "VENDEDOR", senha: "1234567" },
          autorId,
          companyId
        )
      ).rejects.toThrow(/pelo menos 8 caracteres/);
    });

    it("recusa senha acima de 72 bytes, que o bcrypt truncaria em silêncio", async () => {
      // Sem este teto, esta senha e os seus 72 primeiros bytes autenticariam
      // a mesma conta — o bcrypt descarta o excedente sem avisar ninguém.
      await expect(
        criarUsuario(
          { nome: "Senha Longa", email: email("longa"), papel: "VENDEDOR", senha: "a".repeat(73) },
          autorId,
          companyId
        )
      ).rejects.toThrow(/72 bytes/);
    });

    it("conta bytes e não caracteres no teto da senha", async () => {
      // 40 emojis = 160 bytes em UTF-8, mas só 80 unidades de código em JS.
      // É o byte que o bcrypt conta.
      await expect(
        criarUsuario(
          { nome: "Emoji", email: email("emoji"), papel: "VENDEDOR", senha: "🔒".repeat(40) },
          autorId,
          companyId
        )
      ).rejects.toThrow(/72 bytes/);
    });

    it("recusa papel que não existe, mesmo vindo de fora do TypeScript", async () => {
      await expect(
        criarUsuario(
          // O tipo `Role` não vale nada contra um POST montado à mão — daí o
          // cast, que reproduz exatamente o que chegaria pela Server Action.
          { nome: "Papel Falso", email: email("papel"), papel: "SUPERADMIN" as never, senha: "senha-de-teste" },
          autorId,
          companyId
        )
      ).rejects.toThrow(/Papel inválido/);
    });

    it("recusa nome vazio e e-mail malformado", async () => {
      await expect(
        criarUsuario(
          { nome: "   ", email: email("vazio"), papel: "VENDEDOR", senha: "senha-de-teste" },
          autorId,
          companyId
        )
      ).rejects.toThrow(/nome é obrigatório/);

      await expect(
        criarUsuario(
          { nome: "Sem Arroba", email: "nao-e-email", papel: "VENDEDOR", senha: "senha-de-teste" },
          autorId,
          companyId
        )
      ).rejects.toThrow(/E-mail inválido/);
    });
  });

  describe("desativação", () => {
    it("desativa e reativa, registrando auditoria dos dois lados", async () => {
      const alvo = await criarUsuario(
        { nome: "Vai e Volta", email: email("toggle"), papel: "VENDEDOR", senha: "senha-de-teste" },
        autorId,
        companyId
      );

      const desativado = await definirAtivo({ id: alvo.id, ativo: false }, autorId, companyId);
      expect(desativado.ativo).toBe(false);

      const reativado = await definirAtivo({ id: alvo.id, ativo: true }, autorId, companyId);
      expect(reativado.ativo).toBe(true);

      const acoes = await prisma.auditLog.findMany({
        where: { userId: autorId, entidade: "User", entidadeId: alvo.id },
        select: { acao: true },
      });
      expect(acoes.map((a) => a.acao).sort()).toEqual(["ativar_usuario", "criar_usuario", "desativar_usuario"]);
    });

    it("não deixa alguém desativar a própria conta", async () => {
      await expect(definirAtivo({ id: autorId, ativo: false }, autorId, companyId)).rejects.toThrow(
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
        autorId,
        companyId
      );

      const depois = await atualizarUsuario({ id: alvo.id, nome: "Nome Novo", papel: "GESTOR" }, autorId, companyId);

      expect(depois.nome).toBe("Nome Novo");
      expect(depois.papel).toBe("GESTOR");
      expect(depois).not.toHaveProperty("senhaHash");

      const log = await prisma.auditLog.findFirst({
        where: { userId: autorId, entidadeId: alvo.id, acao: "editar_usuario" },
      });
      expect(log?.antes).toEqual({ nome: "Nome Antigo", papel: "VENDEDOR" });
      expect(log?.depois).toEqual({ nome: "Nome Novo", papel: "GESTOR" });

      // A escrita foi para o Membership, não para uma coluna que não existe
      // mais em User — prova direta no banco, não só no retorno da função.
      const vinculo = await prisma.membership.findUniqueOrThrow({
        where: { userId_companyId: { userId: alvo.id, companyId } },
      });
      expect(vinculo.papel).toBe("GESTOR");
    });

    it("não deixa alguém mudar o próprio papel", async () => {
      await expect(
        atualizarUsuario(
          { id: autorId, nome: "Autor de teste (users service)", papel: "VENDEDOR" },
          autorId,
          companyId
        )
      ).rejects.toThrow(/não pode mudar o próprio papel/);
    });

    it("deixa a pessoa editar o próprio nome, contanto que o papel não mude", async () => {
      const depois = await atualizarUsuario(
        { id: autorId, nome: "Autor Renomeado", papel: "ADMIN" },
        autorId,
        companyId
      );
      expect(depois.nome).toBe("Autor Renomeado");
    });

    it("recusa editar quem não tem vínculo com esta empresa", async () => {
      const outraEmpresa = await prisma.company.create({ data: { nome: `${PREFIXO}outra-empresa` } });
      try {
        const semVinculoAqui = await criarUsuario(
          { nome: "De Outra Empresa", email: email("outra-empresa"), papel: "VENDEDOR", senha: "senha-de-teste" },
          autorId,
          outraEmpresa.id
        );

        await expect(
          atualizarUsuario({ id: semVinculoAqui.id, nome: "Tentativa", papel: "ADMIN" }, autorId, companyId)
        ).rejects.toThrow(/Usuário não encontrado/);
      } finally {
        // Limpa nesta ordem: User (cascade leva o Membership) antes da
        // Company, mesmo raciocínio do afterAll do arquivo inteiro.
        // O `AuditLog` de `criarUsuario` nasce na empresa que a função RECEBEU
        // — não mais na do autor. Foi o que mudou no Ciclo 1d, quando
        // `ParamsDeAuditoria` ganhou `companyId` obrigatório: a linha ficava na
        // empresa do vínculo de quem agiu, e agora fica na da entidade. O
        // `delete` da empresa abaixo passa a esbarrar em
        // `AuditLog_companyId_fkey` sem esta limpeza — foi assim que estes três
        // testes acusaram a mudança.
        await prisma.auditLog.deleteMany({ where: { companyId: outraEmpresa.id } });
        await prisma.user.deleteMany({ where: { email: email("outra-empresa") } });
        await prisma.company.delete({ where: { id: outraEmpresa.id } });
      }
    });
  });

  describe("redefinirSenha", () => {
    // A METADE QUE FALTAVA, e o pior defeito do Ciclo 1a enquanto durou:
    // `redefinirSenha` achava o alvo com `user.findUnique({ id })` e mais
    // nada — sem `Membership`, sem `companyId` —, enquanto as três vizinhas
    // do mesmo arquivo (`atualizarUsuario`, `definirAtivo`,
    // `garantirQueSobraAdmin`) já recusavam quem não tem vínculo. `entrada.id`
    // chega de `redefinirSenhaAction`, que é Server Action, ou seja, endpoint
    // HTTP público: um ADMIN da empresa A trocava a senha do ADMIN da empresa
    // B e entrava com ela. Não é leitura de dado alheio, é tomada de conta.
    //
    // Este caso e o de baixo ("troca o hash...") são um par indivisível: sem
    // o segundo, "recusar todo mundo" passaria como correção.
    it("recusa alvo sem vínculo com a empresa de quem age, e não toca no hash", async () => {
      const outraEmpresa = await prisma.company.create({
        data: { nome: `${PREFIXO}outra-empresa-senha` },
      });
      try {
        const alvo = await criarUsuario(
          { nome: "Admin da Outra", email: email("senha-outra"), papel: "ADMIN", senha: "senha-original" },
          autorId,
          outraEmpresa.id
        );

        await expect(
          redefinirSenha({ id: alvo.id, senha: "senha-tomada" }, autorId, companyId)
        ).rejects.toThrow(UsuarioInvalidoError);

        // Recusar não basta: o hash antigo tem que continuar valendo. Sem
        // esta leitura, uma implementação que gravasse e SÓ DEPOIS lançasse
        // passaria — e a conta estaria tomada do mesmo jeito.
        const { senhaHash } = await prisma.user.findUniqueOrThrow({
          where: { id: alvo.id },
          select: { senhaHash: true },
        });
        expect(await bcrypt.compare("senha-tomada", senhaHash)).toBe(false);
        expect(await bcrypt.compare("senha-original", senhaHash)).toBe(true);

        // E nada de auditoria de uma redefinição que não aconteceu.
        const log = await prisma.auditLog.findFirst({
          where: { entidadeId: alvo.id, acao: "redefinir_senha" },
        });
        expect(log).toBeNull();
      } finally {
        await prisma.auditLog.deleteMany({ where: { companyId: outraEmpresa.id } });
        await prisma.user.deleteMany({ where: { email: email("senha-outra") } });
        await prisma.company.delete({ where: { id: outraEmpresa.id } });
      }
    });

    it("troca o hash e a senha nova passa a valer", async () => {
      const alvo = await criarUsuario(
        { nome: "Esqueceu a Senha", email: email("senha"), papel: "VENDEDOR", senha: "senha-antiga" },
        autorId,
        companyId
      );

      await redefinirSenha({ id: alvo.id, senha: "senha-nova-valida" }, autorId, companyId);

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
        autorId,
        companyId
      );

      await redefinirSenha({ id: alvo.id, senha: "outra-senha-valida" }, autorId, companyId);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { userId: autorId, entidadeId: alvo.id, acao: "redefinir_senha" },
      });
      expect(log.antes).toBeNull();
      expect(log.depois).toBeNull();
    });
  });

  describe("gestão de equipe — queries", () => {
    it("listarUsuarios lista só quem tem vínculo com a empresa consultada", async () => {
      const usuarios = await listarUsuarios(companyId);
      expect(usuarios.length).toBeGreaterThan(0);
      expect(usuarios.every((u) => u.id !== ID_SISTEMA_WHATSAPP)).toBe(true);
    });

    it("a listagem nunca traz senhaHash", async () => {
      const usuarios = await listarUsuarios(companyId);
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

      expect(await buscarUsuario(ID_SISTEMA_WHATSAPP, companyId)).toBeNull();
    });

    it("buscarUsuario devolve null para quem não tem vínculo com a empresa consultada", async () => {
      const outraEmpresa = await prisma.company.create({ data: { nome: `${PREFIXO}outra-empresa-busca` } });
      try {
        const criado = await criarUsuario(
          { nome: "Só Na Outra", email: email("so-na-outra"), papel: "VENDEDOR", senha: "senha-de-teste" },
          autorId,
          outraEmpresa.id
        );

        expect(await buscarUsuario(criado.id, companyId)).toBeNull();
        expect(await buscarUsuario(criado.id, outraEmpresa.id)).not.toBeNull();
      } finally {
        await prisma.auditLog.deleteMany({ where: { companyId: outraEmpresa.id } });
        await prisma.user.deleteMany({ where: { email: email("so-na-outra") } });
        await prisma.company.delete({ where: { id: outraEmpresa.id } });
      }
    });
  });

  describe("contas de sistema", () => {
    it("não podem ser editadas, desativadas nem ter a senha trocada", async () => {
      await expect(
        atualizarUsuario({ id: ID_SISTEMA_WHATSAPP, nome: "Sequestrado", papel: "ADMIN" }, autorId, companyId)
      ).rejects.toThrow(/conta é do sistema/);

      // Reativar o robô é o caso perigoso: ele é ADMIN e não consegue fazer
      // login, então passaria a contar como "administrador ativo" na proteção
      // do último ADMIN — e o sistema autorizaria desativar a última pessoa
      // de verdade.
      await expect(
        definirAtivo({ id: ID_SISTEMA_WHATSAPP, ativo: true }, autorId, companyId)
      ).rejects.toThrow(/conta é do sistema/);

      await expect(
        redefinirSenha({ id: ID_SISTEMA_WHATSAPP, senha: "senha-de-teste" }, autorId, companyId)
      ).rejects.toThrow(/conta é do sistema/);

      const robo = await prisma.user.findUniqueOrThrow({ where: { id: ID_SISTEMA_WHATSAPP } });
      expect(robo.ativo).toBe(false);
      expect(robo.nome).toBe("Atendente WhatsApp (sistema)");
    });
  });
});
