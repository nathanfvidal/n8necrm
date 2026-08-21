// Este arquivo usa o Prisma real contra o Postgres do Supabase (mesmo padrão de
// `rate-limit.test.ts` e `audit-log.test.ts`), e carrega DATABASE_URL aqui — não
// em vitest.config.ts — para não injetar credenciais em arquivos de teste que
// não tocam banco. Precisa ser o primeiro import: `src/lib/prisma.ts` →
// `src/lib/env.ts` lê `process.env.DATABASE_URL` no topo do módulo.
import "dotenv/config";

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// "server-only" só resolve para no-op sob a condição de resolução
// "react-server" do Next; fora dela lança. Mesmo mock de `rate-limit.test.ts`.
vi.mock("server-only", () => ({}));

import { semComentarios } from "./helpers/codigo-fonte";
import { prisma } from "../../src/lib/prisma";
import {
  FilaPostgres,
  reivindicarJob,
  concluirJob,
  falharJob,
  podarJobsMortos,
  MAX_TENTATIVAS_ENTREGA,
  RETRY_APOS_MS,
} from "../../src/modules/whatsapp/fila/postgres";

// Empresa e conversa próprias, criadas e apagadas por este arquivo. Não
// reutilizamos o seed: a reivindicação é CROSS-TENANT por construção, então um
// job de outra origem no banco entraria no `ORDER BY` e tornaria os casos
// dependentes do que mais estivesse na tabela.
let companyId = "";
let conversationId = "";

async function limpar() {
  if (companyId) await prisma.turnoJob.deleteMany({ where: { companyId } });
}

beforeEach(async () => {
  if (!companyId) {
    const empresa = await prisma.company.create({ data: { nome: "teste-fila-2d" } });
    companyId = empresa.id;
    const conversa = await prisma.conversation.create({
      data: { companyId, waId: `teste-fila-2d-${Date.now()}` },
    });
    conversationId = conversa.id;
  }
  await limpar();

  // NUNCA `deleteMany({})`. Esta suíte roda contra o Postgres REAL, compartilhado
  // entre desenvolvimento e produção — apagar a fila inteira apagaria trabalho de
  // verdade, e um teste que destrói dado alheio é pior que um teste ausente.
  //
  // Mas os casos abaixo SÃO cross-tenant por natureza (`reivindicarJob` não tem
  // empresa), então um job de outra origem entraria no `ORDER BY` e roubaria o
  // resultado. A saída é falhar ALTO em vez de limpar: quem vir esta mensagem
  // esvazia a fila de propósito, ou espera ela drenar.
  const alheios = await prisma.turnoJob.count({ where: { companyId: { not: companyId } } });
  if (alheios > 0) {
    throw new Error(
      `Há ${alheios} job(s) de outras empresas em TurnoJob. Este arquivo reivindica ` +
        `SEM escopo (é o que ele existe para exercitar) e não pode rodar sobre uma ` +
        `fila viva — ele pegaria trabalho real. Drene a fila antes de rodar.`
    );
  }
});

// Na ordem das FKs: os jobs apontam para a conversa, que aponta para a empresa.
// `TurnoJob → Company` é `onDelete: Restrict`, então apagar a empresa antes dos
// jobs falharia — e falharia DEPOIS de o arquivo já ter passado, que é a forma
// mais confusa possível de descobrir isso.
afterAll(async () => {
  await limpar();
  if (conversationId) await prisma.conversation.deleteMany({ where: { id: conversationId } });
  if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

function job(seq: number, tentativaReagendamento?: number) {
  return { companyId, conversationId, seq, tentativaReagendamento };
}

describe("FilaPostgres.publicar", () => {
  it("grava uma linha disponível em ~8s por padrão", async () => {
    const antes = Date.now();
    await new FilaPostgres().publicar(job(1));

    const linhas = await prisma.turnoJob.findMany({ where: { companyId } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].chaveIdempotencia).toBe(`${conversationId}:1`);
    expect(linhas[0].disponivelEm.getTime()).toBeGreaterThanOrEqual(antes + 7_000);
    expect(linhas[0].disponivelEm.getTime()).toBeLessThan(antes + 12_000);
    expect(linhas[0].leaseAte).toBeNull();
    expect(linhas[0].tentativasEntrega).toBe(0);
  });

  it("respeita o delay informado e sufixa a chave por tentativa de reagendamento", async () => {
    await new FilaPostgres().publicar(job(2, 3), { delaySeconds: 5 });

    const linha = await prisma.turnoJob.findFirst({ where: { companyId, seq: 2 } });
    expect(linha?.chaveIdempotencia).toBe(`${conversationId}:2:r3`);
    expect(linha?.tentativaReagendamento).toBe(3);
  });

  it("publicar duas vezes a MESMA chave deixa UMA linha, e não lança", async () => {
    // Substitui o `DuplicateMessageError` da Vercel: os dois chamadores
    // (`turno.ts` e a rota do webhook) já traduziam aquela exceção para "tudo
    // bem", então a tradução passa a acontecer aqui e o tipo do provedor some.
    const fila = new FilaPostgres();
    await fila.publicar(job(3));
    await expect(fila.publicar(job(3))).resolves.toBeUndefined();

    expect(await prisma.turnoJob.count({ where: { companyId, seq: 3 } })).toBe(1);
  });

  it("recusa publicar job de OUTRA empresa — o escopo morde antes do banco", async () => {
    // `publicar` é um dos três caminhos escopados: a empresa EXISTE antes de
    // tocar o banco, então `prismaDaEmpresa` confere que o `companyId` do dado
    // bate com o do cliente. Sem este caso, trocar o cliente escopado pelo cru
    // aqui passaria despercebido — o comportamento observável só mudaria no dia
    // de um `companyId` divergente, que é tarde demais.
    await expect(
      new FilaPostgres().publicar({ ...job(99), companyId: "empresa-que-nao-e-a-do-cliente" })
    ).rejects.toThrow(/companyId/);
  });
});

describe("reivindicarJob", () => {
  it("não entrega job cujo `disponivelEm` ainda está no futuro", async () => {
    await new FilaPostgres().publicar(job(4)); // 8s à frente
    expect(await reivindicarJob()).toBeNull();
  });

  it("entrega o job disponível, incrementa a tentativa e devolve o fencing token", async () => {
    await new FilaPostgres().publicar(job(5), { delaySeconds: 0 });

    const reivindicado = await reivindicarJob();
    expect(reivindicado).not.toBeNull();
    expect(reivindicado!.companyId).toBe(companyId);
    expect(reivindicado!.conversationId).toBe(conversationId);
    expect(reivindicado!.seq).toBe(5);
    expect(reivindicado!.tentativasEntrega).toBe(1);

    const linha = await prisma.turnoJob.findFirst({ where: { id: reivindicado!.id } });
    expect(linha?.leaseAte?.getTime()).toBe(reivindicado!.leaseAte.getTime());
  });

  it("não entrega job com lease vivo, e entrega quando o lease expirou", async () => {
    await new FilaPostgres().publicar(job(6), { delaySeconds: 0 });
    const primeiro = await reivindicarJob();
    expect(primeiro).not.toBeNull();

    expect(await reivindicarJob()).toBeNull();

    await prisma.turnoJob.updateMany({
      where: { id: primeiro!.id },
      data: { leaseAte: new Date(Date.now() - 1_000) },
    });
    const segundo = await reivindicarJob();
    expect(segundo?.id).toBe(primeiro!.id);
    expect(segundo?.tentativasEntrega).toBe(2);
  });

  it("nunca entrega job morto", async () => {
    await new FilaPostgres().publicar(job(7), { delaySeconds: 0 });
    await prisma.turnoJob.updateMany({ where: { companyId }, data: { mortoEm: new Date() } });
    expect(await reivindicarJob()).toBeNull();
  });

  it("N reivindicações CONCORRENTES sobre M jobs devolvem ids DISTINTOS", async () => {
    // O caso que prova a exclusão mútua. Mesmo método de `rate-limit.test.ts`:
    // `Promise.all` contra o Postgres real, porque o defeito só aparece com
    // conexões de verdade disputando a mesma linha.
    //
    // ## Por que 12 jobs e 24 reivindicadores, e não 3 e 5
    //
    // Porque 3 e 5 NÃO MORDIAM, e isso foi medido, não suposto. Com a versão
    // mutilada do SQL (sem `FOR UPDATE SKIP LOCKED` e sem as condições
    // repetidas fora do subselect), 5 chamadas simultâneas sobre 3 jobs
    // devolveram 3 ids distintos em toda execução: cada instrução é rápida
    // demais para as janelas se cruzarem, e o caso passava pelo motivo errado —
    // teria dado verde sobre um SQL que entrega o mesmo job duas vezes.
    //
    // Com 24 sobre 12, a mesma mutilação devolveu 14 e 15 ids para 12 jobs em
    // quatro execuções seguidas (2026-08-21) — ou seja, entregou job repetido
    // toda vez. É o menor tamanho medido em que o caso reprova o SQL errado, e
    // é por isso que ele está aqui.
    //
    // ## Por que a igualdade é exata
    //
    // Com `SKIP LOCKED`, uma linha pulada é uma linha TRAVADA por outro
    // reivindicador — que, por já ter o lock, vai commitar e ficar com ela. Um
    // reivindicador só volta de mãos vazias quando TODAS as linhas estão
    // travadas por reivindicadores distintos, e aí aqueles sucessos existem.
    // `min(N, M)` é igualdade, não aproximação.
    const JOBS = 12;
    const REIVINDICADORES = 24;

    const fila = new FilaPostgres();
    for (let i = 100; i < 100 + JOBS; i++) await fila.publicar(job(i), { delaySeconds: 0 });

    const resultados = await Promise.all(
      Array.from({ length: REIVINDICADORES }, () => reivindicarJob())
    );

    const ids = resultados.filter((r) => r !== null).map((r) => r!.id);
    expect(ids).toHaveLength(JOBS);
    expect(new Set(ids).size).toBe(JOBS);
  });
});

describe("concluirJob e falharJob — o fencing token", () => {
  it("concluir apaga a linha", async () => {
    await new FilaPostgres().publicar(job(8), { delaySeconds: 0 });
    const r = (await reivindicarJob())!;

    expect(await concluirJob(r.companyId, r.id, r.leaseAte)).toBe(true);
    expect(await prisma.turnoJob.count({ where: { id: r.id } })).toBe(0);
  });

  it("concluir com token ERRADO não apaga nada", async () => {
    // Sem o fencing, um processador lento que termina DEPOIS de outro ter
    // reivindicado o mesmo job apagaria o trabalho de quem está ativo — o
    // achado C1 que `turno.ts` já corrigiu no lease da CONVERSA.
    await new FilaPostgres().publicar(job(9), { delaySeconds: 0 });
    const r = (await reivindicarJob())!;

    expect(await concluirJob(r.companyId, r.id, new Date(r.leaseAte.getTime() + 1))).toBe(false);
    expect(await prisma.turnoJob.count({ where: { id: r.id } })).toBe(1);
  });

  it("falhar reagenda para daqui a RETRY_APOS_MS e libera o lease", async () => {
    await new FilaPostgres().publicar(job(10), { delaySeconds: 0 });
    const r = (await reivindicarJob())!;

    const antes = Date.now();
    expect(await falharJob(r.companyId, r.id, r.leaseAte, "explodiu")).toBe("reagendado");

    const linha = await prisma.turnoJob.findFirst({ where: { id: r.id } });
    expect(linha?.leaseAte).toBeNull();
    expect(linha?.mortoEm).toBeNull();
    expect(linha?.ultimoErro).toBe("explodiu");
    expect(linha!.disponivelEm.getTime()).toBeGreaterThanOrEqual(antes + RETRY_APOS_MS - 1_000);
  });

  it("falhar na última tentativa MATA o job em vez de reagendar", async () => {
    await new FilaPostgres().publicar(job(11), { delaySeconds: 0 });
    let desfecho = "";
    for (let i = 0; i < MAX_TENTATIVAS_ENTREGA; i++) {
      const r = (await reivindicarJob())!;
      desfecho = await falharJob(r.companyId, r.id, r.leaseAte, `falha ${i}`);
      // Reagendou para daqui a 30s; o teste não espera — puxa a data para trás.
      await prisma.turnoJob.updateMany({
        where: { id: r.id },
        data: { disponivelEm: new Date(Date.now() - 1_000) },
      });
    }

    expect(desfecho).toBe("morto");
    const linha = await prisma.turnoJob.findFirst({ where: { companyId, seq: 11 } });
    expect(linha?.mortoEm).not.toBeNull();
    expect(await reivindicarJob()).toBeNull();
  });

  it("falhar com token errado devolve `lease-perdido` e não mexe na linha", async () => {
    await new FilaPostgres().publicar(job(12), { delaySeconds: 0 });
    const r = (await reivindicarJob())!;

    expect(await falharJob(r.companyId, r.id, new Date(0), "x")).toBe("lease-perdido");
    const linha = await prisma.turnoJob.findFirst({ where: { id: r.id } });
    expect(linha?.ultimoErro).toBeNull();
    expect(linha?.leaseAte?.getTime()).toBe(r.leaseAte.getTime());
  });
});

describe("podarJobsMortos", () => {
  it("apaga job morto além da retenção e preserva o recente", async () => {
    const fila = new FilaPostgres();
    await fila.publicar(job(13), { delaySeconds: 0 });
    await fila.publicar(job(14), { delaySeconds: 0 });
    await prisma.turnoJob.updateMany({
      where: { companyId, seq: 13 },
      data: { mortoEm: new Date(Date.now() - 8 * 24 * 60 * 60_000) },
    });
    await prisma.turnoJob.updateMany({
      where: { companyId, seq: 14 },
      data: { mortoEm: new Date() },
    });

    expect(await podarJobsMortos(companyId)).toBe(1);
    expect(await prisma.turnoJob.count({ where: { companyId, seq: 14 } })).toBe(1);
  });

  it("nunca apaga job VIVO, por mais velho que seja", async () => {
    await new FilaPostgres().publicar(job(15), { delaySeconds: 0 });
    await prisma.turnoJob.updateMany({
      where: { companyId, seq: 15 },
      data: { criadoEm: new Date(Date.now() - 365 * 24 * 60 * 60_000) },
    });

    expect(await podarJobsMortos(companyId, 0)).toBe(0);
    expect(await prisma.turnoJob.count({ where: { companyId, seq: 15 } })).toBe(1);
  });
});

describe("a forma do SQL cru deste módulo", () => {
  // Este arquivo está na EXCECAO_PERMANENTE do eslint, e por isso a Parte 2b de
  // `catraca-prisma-cru.test.ts` — que lê o TEXTO de todo `$queryRaw` e reprova
  // quem citar tabela de tenant sem `companyId` — NÃO o cobre: a varredura dela
  // exclui de propósito todo arquivo listado em qualquer das quatro listas
  // (`naFila`, no describe "portas de serviço de um arquivo já convertido").
  // Estes casos são a compensação que o spec §5.1 promete.
  //
  // `semComentarios` não é folga, é a mesma distinção que o próprio
  // `catraca-prisma-cru.test.ts` faz entre IMPORTAR e MENCIONAR: o módulo
  // documenta a própria exceção em prosa, e a prosa precisa nomear `$queryRaw`
  // para explicar por que só pode haver um. Contar a prosa faria a varredura
  // reprovar a documentação da regra que ela existe para defender — o tropeço
  // que `tests/unit/helpers/codigo-fonte.ts` registra na primeira linha. O
  // describe "a varredura morde de verdade", logo abaixo, prova que a remoção
  // de comentário não abre buraco.
  const CAMINHO = fileURLToPath(
    new URL("../../src/modules/whatsapp/fila/postgres.ts", import.meta.url)
  );
  const codigo = semComentarios(readFileSync(CAMINHO, "utf8"));

  it("tem EXATAMENTE um `$queryRaw` e nenhum `$executeRaw`", () => {
    expect(codigo.match(/\$queryRaw/g) ?? []).toHaveLength(1);
    expect(codigo.match(/\$executeRaw/g) ?? []).toHaveLength(0);
  });

  it("o `RETURNING` da reivindicação devolve `companyId`", () => {
    // Sem isto, um refator que parasse de devolver a empresa faria todo o resto
    // do fluxo (concluir, falhar, podar) cair em `undefined` em silêncio.
    expect(codigo).toMatch(/RETURNING[\s\S]{0,200}"companyId"/);
  });

  it("o único `$queryRaw` sai do cliente CRU, e não de um `prismaDaEmpresa`", () => {
    // Um `prismaDaEmpresa(x).$queryRaw` compilaria e passaria intacto (o escopo
    // não alcança SQL cru), dando a APARÊNCIA de escopo onde não há nenhum.
    expect(codigo).toMatch(/prisma\.\$queryRaw/);
    expect(codigo).not.toMatch(/prismaDaEmpresa\([^)]*\)\.\$queryRaw/);
  });

  it("as condições de lease aparecem DUAS vezes — é a repetição que dá atomicidade", () => {
    // Não é estilo. Sob READ COMMITTED, o subselect já foi avaliado quando o
    // segundo reivindicador destrava; o que ele reavalia é a cláusula do
    // PRÓPRIO `UPDATE`. Tirar a repetição de fora deixa `"id" = X` casando
    // sozinho, e o job recém-reivindicado é entregue duas vezes. O caso
    // concorrente acima falha quando isso acontece; este diz ONDE, no lugar em
    // que alguém estaria prestes a "simplificar".
    expect(codigo.match(/"leaseAte" IS NULL OR "leaseAte" </g) ?? []).toHaveLength(2);
    expect(codigo.match(/"mortoEm" IS NULL/g) ?? []).toHaveLength(2);
    expect(codigo).toMatch(/FOR UPDATE SKIP LOCKED/);
  });
});

describe("a varredura morde de verdade", () => {
  // Sem esta seção, `semComentarios` poderia estar engolindo o arquivo inteiro
  // (foi exatamente o que aconteceu na primeira execução de
  // `catraca-prisma-cru.test.ts`, com um glob `/*` que abria um bloco falso) e
  // os quatro casos acima passariam sobre uma string vazia.
  it("um `$queryRaw` de verdade a mais É contado; um em comentário NÃO", () => {
    const comSegundoDeVerdade = semComentarios(
      "const a = prisma.$queryRaw`SELECT 1`;\nconst b = prisma.$queryRaw`SELECT 2`;\n"
    );
    expect(comSegundoDeVerdade.match(/\$queryRaw/g) ?? []).toHaveLength(2);

    const soEmComentario = semComentarios(
      "// nunca use um segundo $queryRaw aqui\n/* nem $queryRaw em bloco */\nconst a = prisma.$queryRaw`SELECT 1`;\n"
    );
    expect(soEmComentario.match(/\$queryRaw/g) ?? []).toHaveLength(1);
  });
});
