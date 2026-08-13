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
import { SESSAO_ADMIN } from "./credenciais";

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

test.beforeAll(async () => {
  await limpar();
  // Primeira etapa do funil: o lead precisa cair numa coluna que o quadro
  // desenha. Qualquer etapa serve, e `ordem: asc` é a que existe sempre.
  const etapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });
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
