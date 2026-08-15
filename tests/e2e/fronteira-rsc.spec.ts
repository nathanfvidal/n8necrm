// A fronteira servidor→cliente do funil, conferida no payload de verdade.
//
// ## Por que este arquivo existe
//
// O pior defeito que este CRM já teve esteve NO AR: `listarLeadsPorEtapa`
// usava `include: { contact: true }`, e `include` traz todas as colunas
// escalares junto com a relação. Todo navegador que abrisse `/leads/kanban`
// recebia, por lead: `contact.email`, `contact.criadoEm`, `lead.utm` (JSON de
// rastreio), `lead.sessionId`, `lead.itemId`, `lead.ultimaInteracaoEm`,
// `lead.arquivadoEm`. O cartão desenhava 4 campos; o payload carregava 15.
//
// A correção (troca por `select` projetado + DTO `LeadDoQuadro`) foi medida
// UMA vez, à mão, no dia em que foi feita. Isso não é proteção — é uma
// fotografia. Nada no projeto falhava se alguém reabrisse o buraco, e a
// consulta é o tipo de lugar onde "só preciso de mais um campo" o reabre sem
// ninguém notar.
//
// ## Onde a barreira REALMENTE mora (aprendido sabotando)
//
// A primeira sabotagem deste teste foi trocar o `select` de volta por
// `include: { contact: true }` — e o teste continuou VERDE. O motivo é exato:
// `include` muda o que a consulta BUSCA do banco, não o que atravessa a
// fronteira, porque o `.map()` para `LeadDoQuadro` projeta depois. As duas
// partes da correção têm papéis diferentes:
//
//   - o `select` é economia (não buscar o que não se usa);
//   - o `.map()` para o DTO é a BARREIRA.
//
// O vermelho só veio com a sabotagem que reproduz o defeito original de
// verdade: `include` **mais** `...lead` espalhado dentro do `.map()`. Quem
// for reprovar este teste um dia precisa sabotar o DTO, não a consulta —
// sabotar o `select` dá um falso "o teste não pega nada".
//
// ## Por que asserção por VALOR, e não por chave
//
// O payload RSC vem embutido no HTML como JSON escapado: a chave `email`
// aparece como `\"email\"`, não `"email"`, e uma busca ingênua pela segunda
// forma passa verde com o vazamento presente. Valores semeados não têm esse
// problema — um marcador único atravessa qualquer camada de escape
// literalmente igual, porque é só texto.
//
// ## A metade que impede o teste de ser vazio
//
// Um teste que só afirma ausência passa com a página em branco, com o lead
// não semeado, com o login quebrado. Por isso ele exige primeiro a PRESENÇA
// do nome do contato: é a prova de que este lead chegou mesmo ao payload
// examinado. Sem essa linha, este arquivo entraria direto na armadilha do
// "teste que não exercita".
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";
import { SESSAO_ADMIN, SESSAO_VENDEDOR } from "./credenciais";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MARCA = "ZZE2EFronteira";
const TELEFONE = "11988886202";
const NOME_CONTATO = `Contato ${MARCA}`;

/**
 * Marcadores únicos, um por coluna que `include` vazava. São improváveis o
 * bastante para que uma ocorrência no HTML só possa ter vindo daqui — o que
 * torna a asserção de ausência específica em vez de supersticiosa.
 *
 * `.invalid` é TLD reservado (RFC 2606): nada aqui pode resolver para um
 * domínio real nem virar e-mail enviado por engano.
 */
const EMAIL_SECRETO = `zz-nao-deve-vazar-${MARCA}@exemplo.invalid`;
const SESSION_SECRETO = `zzsessao-nao-deve-vazar-${MARCA}`;
const ITEM_SECRETO = `zzitem-nao-deve-vazar-${MARCA}`;
const UTM_SECRETO = `zzutm-nao-deve-vazar-${MARCA}`;

async function limpar(): Promise<void> {
  await prisma.lead.deleteMany({ where: { sessionId: SESSION_SECRETO } });
  await prisma.contact.deleteMany({
    where: { OR: [{ nome: { contains: MARCA } }, { telefone: TELEFONE }] },
  });
}

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_ADMIN });

/** Nome da etapa onde o lead marcado foi semeado — metade positiva de `/etapas`. */
let nomeDaPrimeiraEtapa = "";

test.beforeAll(async () => {
  await limpar();
  // Primeira etapa do funil: o lead precisa cair numa coluna que o quadro
  // desenha. Qualquer etapa serve, e `ordem: asc` é a que existe sempre.
  const etapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });
  nomeDaPrimeiraEtapa = etapa.nome;
  const contato = await prisma.contact.create({
    data: { nome: NOME_CONTATO, telefone: TELEFONE, email: EMAIL_SECRETO },
  });
  await prisma.lead.create({
    data: {
      contactId: contato.id,
      stageId: etapa.id,
      canal: "MANUAL",
      sessionId: SESSION_SECRETO,
      itemId: ITEM_SECRETO,
      utm: { campanha: UTM_SECRETO },
    },
  });
});

test.afterAll(async () => {
  await limpar();
  await prisma.$disconnect();
});

test("o payload do funil carrega o que o cartão desenha, e nada além", async ({ page }) => {
  await page.goto("/leads/kanban");
  // Mesmo localizador de `lead-to-won.spec.ts` (`cardEm`): o nome do contato
  // mora no `aria-label` do `<Card>`, que é quem carrega `role="button"`. O
  // `<p>` visível não tem papel nenhum.
  await expect(page.getByRole("button", { name: `Lead ${NOME_CONTATO}`, exact: false })).toBeVisible();

  // `page.content()` devolve o HTML servido, payload RSC embutido incluso —
  // é o mesmo texto que chega no navegador de um cliente qualquer.
  const payload = await page.content();

  // METADE POSITIVA: sem isto, tudo abaixo passa com a página vazia.
  expect(payload, "o lead semeado não chegou ao payload — o teste abaixo seria vazio").toContain(
    NOME_CONTATO
  );

  // METADE NEGATIVA: uma linha por coluna que `include` arrastava junto.
  // Separadas de propósito — um `expect` só com quatro condições diria
  // "falhou" sem dizer QUAL campo voltou a vazar.
  expect(payload, "e-mail do contato no payload do funil — o cartão não o desenha").not.toContain(
    EMAIL_SECRETO
  );
  expect(payload, "sessionId no payload do funil").not.toContain(SESSION_SECRETO);
  expect(payload, "itemId no payload do funil").not.toContain(ITEM_SECRETO);
  expect(payload, "utm (rastreio de campanha) no payload do funil").not.toContain(UTM_SECRETO);
});

// ─── O CPF na fronteira, por papel ──────────────────────────────────────
//
// Achado R2 da auditoria do cadastro de contato: `Contact.documento` é o
// único campo restrito por papel neste sistema. ADMIN e GESTOR veem e editam;
// VENDEDOR não.
//
// A pergunta que este bloco responde não é "o campo aparece na tela?" — é "o
// valor sai do servidor?". São coisas diferentes, e só a segunda é proteção:
// um campo escondido por CSS ou por `&&` no JSX continua no payload, legível
// em "ver código-fonte" por quem nunca vai olhar um pixel da tela.
//
// Os dois lados são medidos de propósito. Só a ausência não bastaria: ela
// passaria igual se a página estivesse quebrada, se o contato não tivesse
// sido semeado, ou se o CPF nunca tivesse sido gravado. O caso do ADMIN é o
// controle que prova que havia algo para vazar.
//
// ## Qual das três camadas estes testes realmente pegam (medido, não suposto)
//
// A proteção tem três partes, e elas NÃO valem o mesmo:
//
//   1. o formulário esconde o campo — conforto, não proteção;
//   2. a consulta zera o documento no mapeamento;
//   3. a action descarta o campo que veio do cliente.
//
// Sabotar o PADRÃO de `incluirDocumento` (trocar `false` por `true` em
// `queries.ts`) deixa estes testes VERDES — medido. O motivo é que a página
// passa o parâmetro explicitamente, então o padrão nunca é consultado por
// este caminho: ele existe para o chamador FUTURO que esquecer o parâmetro.
// O vermelho vem de sabotar a página (`incluirDocumento: true` fixo) ou a
// action. Quem for reprovar estes testes precisa mirar ali.
//
// A sabotagem da action produziu o resultado mais eloquente:
// `Acme ZZE2EFronteira|null` — o CPF APAGADO do banco por um vendedor que só
// queria corrigir o nome da empresa. Esse teste não é sobre privacidade, é
// sobre não perder dado do cliente.
// ─── A gestão do funil na fronteira ─────────────────────────────────────
//
// Achado R6 da auditoria da branch do CRUD de etapas: `/etapas` monta um DTO
// (`EtapaNaTela`) no `.map()` da página, e nada falhava se alguém trocasse esse
// `.map()` por `etapas` cru. Não era defeito — o payload foi medido e estava
// limpo. Era a ausência da trava, no mesmo lugar exato onde este arquivo já
// documenta o defeito que ESTEVE no ar.
//
// A asserção que faz o trabalho é a de `ehPerdido`: é a única coluna que
// `PipelineStage` tem e `EtapaNaTela` não, então ela é a impressão digital da
// linha crua. Diferente das chaves citadas no cabeçalho deste arquivo, buscar
// o identificador NU (sem aspas) atravessa o escape do payload RSC sem
// problema — o que não funciona é procurar `"ehPerdido"` com as aspas.
//
// Sabotagem conferida: espalhar `...etapa` dentro do `.map()` da página deixa
// este teste vermelho, na asserção de `ehPerdido`, com a mensagem certa.
//
// As três marcas de lead reaproveitam o registro semeado no `beforeAll` do topo,
// que vive até o `afterAll` do arquivo (`mode: "serial"`). Elas NÃO têm sabotagem
// própria, e isso é honesto em vez de omitido: o erro que elas miram —
// `listarEtapas()` ganhar `include: { leads: true }` e o lead atravessar junto —
// não é alcançável hoje sem também mudar o tipo de retorno da consulta e o de
// `EtapaNaTela`, então não há como reproduzi-lo com uma linha. Elas ficam como
// rede para o dia em que essa mudança de forma acontecer.
test.describe("gestão do funil na fronteira", () => {
  test.use({ storageState: SESSAO_ADMIN });

  test("o payload de /etapas carrega o DTO da tela, e nenhuma linha crua", async ({ page }) => {
    await page.goto("/etapas");
    await expect(page.getByRole("heading", { name: "Etapas", exact: true })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    const payload = await page.content();

    // METADE POSITIVA: sem isto, tudo abaixo passa com a tabela vazia.
    expect(payload, "a tabela de etapas não chegou ao payload — as asserções abaixo seriam vazias").toContain(
      nomeDaPrimeiraEtapa
    );

    expect(
      payload,
      "linha crua de PipelineStage no payload de /etapas: o .map() para EtapaNaTela deixou de ser a fronteira"
    ).not.toContain("ehPerdido");

    expect(payload, "e-mail de contato no payload de /etapas").not.toContain(EMAIL_SECRETO);
    expect(payload, "sessionId de lead no payload de /etapas").not.toContain(SESSION_SECRETO);
    expect(payload, "utm (rastreio de campanha) no payload de /etapas").not.toContain(UTM_SECRETO);
  });
});

const TELEFONE_CPF = "11988886404";
const NOME_CPF = `Contato CPF ${MARCA}`;
const CPF_SECRETO = "98765432100";

const EMPRESA_CPF = `Acme CPF ${MARCA}`;

let contatoComCpfId = "";
let leadDoContatoComCpfId = "";

async function limparContatoComCpf(): Promise<void> {
  await prisma.lead.deleteMany({
    where: { contact: { nome: { contains: `CPF ${MARCA}` } } },
  });
  await prisma.contact.deleteMany({
    where: { OR: [{ nome: { contains: `CPF ${MARCA}` } }, { telefone: TELEFONE_CPF }] },
  });
}

test.describe("documento do contato na fronteira", () => {
  test.beforeAll(async () => {
    await limparContatoComCpf();
    const criado = await prisma.contact.create({
      data: {
        nome: NOME_CPF,
        telefone: TELEFONE_CPF,
        documento: CPF_SECRETO,
        empresa: EMPRESA_CPF,
      },
    });
    contatoComCpfId = criado.id;
    const etapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });
    const lead = await prisma.lead.create({
      data: { contactId: criado.id, stageId: etapa.id, canal: "MANUAL" },
    });
    leadDoContatoComCpfId = lead.id;
  });

  test.afterAll(async () => {
    await limparContatoComCpf();
  });

  test.describe("como ADMIN", () => {
    test.use({ storageState: SESSAO_ADMIN });

    test("o CPF chega, porque ADMIN pode ver e editar", async ({ page }) => {
      await page.goto(`/contatos/${contatoComCpfId}`);
      await expect(page.getByRole("heading", { name: NOME_CPF })).toBeVisible();

      const payload = await page.content();
      expect(payload, "sem isto, o teste do VENDEDOR passaria sem nada para vazar").toContain(
        CPF_SECRETO
      );
      await expect(page.getByLabel("Documento")).toHaveValue(CPF_SECRETO);
    });

    // A invariante da tela de LEAD, e o caso do ADMIN é o que a torna forte.
    //
    // Este mesmo usuário acabou de ver o CPF em `/contatos/[id]` no teste
    // acima. A ausência aqui, portanto, não é efeito de permissão — é decisão
    // de desenho: o bloco "Pessoa" não busca nem renderiza o documento, para
    // que a regra de quem pode vê-lo exista em UM lugar só. Duplicá-la numa
    // segunda tela é como "regra numa tela, esquecida na outra" acontece.
    //
    // Se um dia o documento precisar aparecer aqui, este teste fica vermelho e
    // obriga quem estiver mexendo a decidir de propósito, em vez de herdar o
    // campo sem perceber.
    test("a tela do lead mostra a pessoa e NUNCA o documento, nem para ADMIN", async ({ page }) => {
      await page.goto(`/leads/${leadDoContatoComCpfId}`);
      await expect(page.getByRole("heading", { name: "Pessoa" })).toBeVisible();

      const payload = await page.content();

      // METADE POSITIVA: o bloco realmente carregou o cadastro desta pessoa.
      // Sem isto, a ausência do CPF passaria com o bloco vazio ou ausente.
      expect(payload, "o bloco Pessoa não trouxe o cadastro — a asserção abaixo seria vazia").toContain(
        EMPRESA_CPF
      );

      expect(
        payload,
        "documento na tela do lead: a regra de permissão mora em /contatos/[id] e não foi repetida aqui de propósito"
      ).not.toContain(CPF_SECRETO);
    });
  });

  test.describe("como VENDEDOR", () => {
    test.use({ storageState: SESSAO_VENDEDOR });

    test("o CPF NÃO chega ao navegador, e o resto do cadastro continua editável", async ({
      page,
    }) => {
      await page.goto(`/contatos/${contatoComCpfId}`);
      // A página abre normalmente: a restrição é de um CAMPO, não da tela.
      await expect(page.getByRole("heading", { name: NOME_CPF })).toBeVisible();

      const payload = await page.content();
      expect(payload, "CPF no payload de quem não tem permissão para vê-lo").not.toContain(
        CPF_SECRETO
      );

      // O campo não existe para ele...
      await expect(page.getByLabel("Documento")).toHaveCount(0);
      // ...e todo o resto continua lá, editável. Se isto quebrar, alguém
      // ampliou a restrição para além do campo que o dono decidiu restringir.
      await expect(page.getByLabel("Nome", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Empresa")).toBeVisible();
      await expect(page.getByLabel("Observações")).toBeVisible();
      await expect(page.getByRole("button", { name: "Salvar alterações" })).toBeVisible();
    });

    test("salvar como VENDEDOR não apaga o CPF que estava gravado", async ({ page }) => {
      // O defeito silencioso que a trava da action existe para impedir: o
      // formulário manda `documento: ""` mesmo sem desenhar o campo, e string
      // vazia vira `null`, que no `update` do Prisma APAGA.
      await page.goto(`/contatos/${contatoComCpfId}`);
      await page.getByLabel("Empresa").fill(`Acme ${MARCA}`);
      await page.getByRole("button", { name: "Salvar alterações" }).click();
      await expect(page.getByRole("status")).toContainText("Contato salvo");

      // Conferido no BANCO, não na tela: a tela nem mostra o campo.
      await expect
        .poll(
          async () => {
            const linha = await prisma.contact.findUnique({
              where: { id: contatoComCpfId },
              select: { documento: true, empresa: true },
            });
            return `${linha?.empresa}|${linha?.documento}`;
          },
          { timeout: 15_000 }
        )
        .toBe(`Acme ${MARCA}|${CPF_SECRETO}`);
    });
  });
});
