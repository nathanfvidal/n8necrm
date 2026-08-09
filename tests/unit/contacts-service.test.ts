// Toca o Postgres real, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { atualizarContato, criarContato, ContatoInvalidoError } from "../../src/core/contacts/service";
import { buscarContatoComHistorico, listarContatos } from "../../src/core/contacts/queries";

// Nomes e telefones exclusivos deste arquivo. Os telefones ficam numa faixa
// que nenhum outro teste nem o seed usa (o seed usa 1199999000x), e a limpeza
// apaga POR ELES — o banco é compartilhado com dado real.
const MARCA = "ZZTesteContatos";
const TELEFONES = {
  basico: "11988887001",
  duplicado: "11988887002",
  colisao: "11988887003",
  busca: "11988887004",
  historico: "11988887005",
};
const TODOS_TELEFONES = Object.values(TELEFONES);

describe("core/contacts", () => {
  let autorId: string;

  beforeAll(async () => {
    // Resíduo de uma execução anterior que tenha morrido no meio — sem isto,
    // o primeiro `criarContato` colidiria e o arquivo inteiro falharia por um
    // motivo que não é o que está sendo testado.
    await limpar();

    const autor = await prisma.user.create({
      data: {
        nome: `Autor ${MARCA}`,
        email: "teste-contatos-autor@teste.local",
        senhaHash: "hash-fake-nao-usado-em-login",
        papel: "ADMIN",
      },
    });
    autorId = autor.id;
  });

  afterAll(async () => {
    await limpar();
    await prisma.auditLog.deleteMany({ where: { userId: autorId } });
    await prisma.user.delete({ where: { id: autorId } });
  });

  // Limpa por telefone E por marca no nome. O nome é a rede de segurança: uma
  // sabotagem que desligue a normalização (ou um bug que a quebre) grava um
  // telefone fora da lista conhecida, e a limpeza por telefone sozinha
  // deixaria a linha para trás num banco compartilhado com dado real. `MARCA`
  // é um marcador que nenhum contato de verdade tem.
  async function limpar() {
    const contatos = await prisma.contact.findMany({
      where: { OR: [{ telefone: { in: TODOS_TELEFONES } }, { nome: { contains: MARCA } }] },
      select: { id: true },
    });
    const ids = contatos.map((c) => c.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entidade: "Contact", entidadeId: { in: ids } } });
      await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    }
  }

  describe("criarContato", () => {
    it("normaliza o telefone antes de gravar", async () => {
      const criado = await criarContato(
        { nome: `Maria ${MARCA}`, telefone: "+55 (11) 98888-7001", email: "MARIA@Exemplo.com" },
        autorId
      );

      // A formatação digitada some: é a mesma normalização que impede a mesma
      // pessoa de virar dois contatos por ter sido digitada de outro jeito.
      expect(criado.telefone).toBe(TELEFONES.basico);
      // E-mail em minúsculas, senão a mesma pessoa tem dois endereços.
      expect(criado.email).toBe("maria@exemplo.com");
    });

    it("guarda null, não string vazia, quando não há e-mail", async () => {
      const criado = await criarContato(
        { nome: `Sem Email ${MARCA}`, telefone: TELEFONES.duplicado, email: "   " },
        autorId
      );
      // Duas formas de dizer "não tem" obrigariam toda consulta futura a
      // lembrar das duas.
      expect(criado.email).toBeNull();
    });

    it("recusa telefone já cadastrado dizendo DE QUEM ele é", async () => {
      // A mensagem com o nome é o que faz a pessoa reconhecer na hora se é a
      // mesma pessoa ou se digitou o número errado.
      await expect(
        criarContato({ nome: `Outro ${MARCA}`, telefone: TELEFONES.duplicado }, autorId)
      ).rejects.toThrow(new RegExp(`já está cadastrado para Sem Email ${MARCA}`));
    });

    it("recusa telefone que não é um número brasileiro reconhecível", async () => {
      await expect(
        criarContato({ nome: `Ruim ${MARCA}`, telefone: "123" }, autorId)
      ).rejects.toThrow(ContatoInvalidoError);

      // E a mensagem é de formulário, não o texto técnico de
      // `normalizarTelefone` (que é feito para log).
      await expect(
        criarContato({ nome: `Ruim ${MARCA}`, telefone: "a definir" }, autorId)
      ).rejects.toThrow(/Use DDD \+ número/);
    });

    it("registra auditoria da criação", async () => {
      const contato = await prisma.contact.findUniqueOrThrow({ where: { telefone: TELEFONES.basico } });
      const log = await prisma.auditLog.findFirst({
        where: { entidade: "Contact", entidadeId: contato.id, acao: "criar_contato" },
      });
      expect(log?.depois).toMatchObject({ telefone: TELEFONES.basico });
    });
  });

  describe("atualizarContato", () => {
    it("edita e guarda antes/depois na auditoria", async () => {
      const criado = await criarContato(
        { nome: `Antes ${MARCA}`, telefone: TELEFONES.colisao },
        autorId
      );

      const depois = await atualizarContato(
        { id: criado.id, nome: `Depois ${MARCA}`, telefone: TELEFONES.colisao, email: "novo@exemplo.com" },
        autorId
      );

      expect(depois.nome).toBe(`Depois ${MARCA}`);
      expect(depois.email).toBe("novo@exemplo.com");

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { entidade: "Contact", entidadeId: criado.id, acao: "editar_contato" },
      });
      expect(log.antes).toMatchObject({ nome: `Antes ${MARCA}`, email: null });
      expect(log.depois).toMatchObject({ nome: `Depois ${MARCA}`, email: "novo@exemplo.com" });
    });

    it("recusa mudar o telefone para um que já é de outra pessoa", async () => {
      const contato = await prisma.contact.findUniqueOrThrow({ where: { telefone: TELEFONES.colisao } });

      await expect(
        atualizarContato(
          { id: contato.id, nome: `Depois ${MARCA}`, telefone: TELEFONES.basico },
          autorId
        )
      ).rejects.toThrow(new RegExp(`já está cadastrado para Maria ${MARCA}`));

      // E nada mudou: a recusa vem do banco, mas o contato continua com o
      // telefone dele.
      const inalterado = await prisma.contact.findUniqueOrThrow({ where: { id: contato.id } });
      expect(inalterado.telefone).toBe(TELEFONES.colisao);
    });
  });

  describe("listarContatos", () => {
    it("encontra por nome sem diferenciar maiúsculas", async () => {
      const encontrados = (await listarContatos(MARCA.toLowerCase())).itens;
      expect(encontrados.length).toBeGreaterThan(0);
      expect(encontrados.every((c) => c.nome.includes(MARCA))).toBe(true);
    });

    it("encontra por telefone mesmo digitado com formatação", async () => {
      const encontrados = (await listarContatos("(11) 98888-7001")).itens;
      expect(encontrados.map((c) => c.telefone)).toContain(TELEFONES.basico);
    });

    it("um termo sem dígitos NÃO devolve a agenda inteira", async () => {
      // Guarda de regressão do bug óbvio desta consulta: incluir
      // `telefone: { contains: digitos }` no OR quando `digitos` é ""
      // casaria com TODOS os telefones e anularia o filtro. Uma busca por
      // "maria" devolveria o banco completo, e ninguém notaria até a agenda
      // crescer.
      await criarContato({ nome: `Alvo Unico ${MARCA}`, telefone: TELEFONES.busca }, autorId);

      const encontrados = (await listarContatos(`Alvo Unico ${MARCA}`)).itens;
      expect(encontrados).toHaveLength(1);
      expect(encontrados[0].telefone).toBe(TELEFONES.busca);
    });

    it("conta os leads de cada contato", async () => {
      const encontrados = (await listarContatos(`Alvo Unico ${MARCA}`)).itens;
      expect(encontrados[0].totalLeads).toBe(0);
    });
  });

  describe("buscarContatoComHistorico", () => {
    it("devolve null para id que não existe, em vez de lançar", async () => {
      expect(await buscarContatoComHistorico("id-que-nao-existe")).toBeNull();
    });

    it("traz os leads e nunca devolve o hash de senha do responsável", async () => {
      const contato = await criarContato(
        { nome: `Historico ${MARCA}`, telefone: TELEFONES.historico },
        autorId
      );
      const etapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });
      const lead = await prisma.lead.create({
        data: { contactId: contato.id, stageId: etapa.id, responsavelId: autorId, canal: "MANUAL" },
      });

      try {
        const comHistorico = await buscarContatoComHistorico(contato.id);

        expect(comHistorico?.leads).toHaveLength(1);
        expect(comHistorico?.leads[0].responsavelNome).toBe(`Autor ${MARCA}`);
        expect(comHistorico?.leads[0].etapaNome).toBe(etapa.nome);

        // Asserção sobre AUSÊNCIA, e vale ser preciso sobre o que ela cobre.
        //
        // Ela NÃO detecta a consulta trazer campos demais: verificado por
        // sabotagem, trocar o `select` do responsável por `include: true` não
        // derruba este teste, porque a função mapeia o resultado para
        // `responsavelNome` e o hash morre no mapeamento antes de virar
        // retorno.
        //
        // O que ela cobre é o passo seguinte, que é o que de fato vaza: se
        // alguém trocar o mapeamento por um spread do lead cru (`...lead`), o
        // hash passa a atravessar a fronteira servidor→cliente dentro das
        // props do componente e termina no HTML. O projeto já teve esse
        // achado. O `select` estreito da consulta continua sendo a defesa
        // certa — só não é esta linha que a protege.
        expect(JSON.stringify(comHistorico)).not.toContain("senhaHash");
        expect(JSON.stringify(comHistorico)).not.toContain("$2b$");
      } finally {
        await prisma.lead.delete({ where: { id: lead.id } });
      }
    });
  });
});
