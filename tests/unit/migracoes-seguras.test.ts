// Regra de migração que uma quebra real deixou escrita.
//
// ## O incidente
//
// `20260813200000_contato_cadastro_completo` criou `Contact.atualizadoEm` como
// `NOT NULL` sem `DEFAULT` — o SQL que o Prisma gera para `@updatedAt`, e que
// é perfeitamente correto quando o banco e o código sobem juntos.
//
// Neste projeto eles nunca sobem juntos: o banco é UM SÓ para desenvolvimento
// e produção (decisão do dono), então a migração é aplicada enquanto o código
// no ar ainda é o anterior. Nessa janela, o cliente Prisma antigo continua
// emitindo `INSERT INTO "Contact" (id, nome, telefone, email)` — sem a coluna
// nova — e o Postgres recusa com `23502`.
//
// O estrago não ficou na tela de contatos: `encontrarOuCriarContact`
// (`core/leads/dedupe.ts`) é o ponto único por onde passa toda criação de lead
// com telefone ainda não cadastrado. Criar lead para número novo falhava junto.
//
// ## O que este teste trava
//
// Coluna `NOT NULL` nova numa tabela QUE JÁ EXISTIA precisa de `DEFAULT` na
// MESMA migração. Numa tabela criada ali mesmo não precisa: não há linha
// antiga nem código antigo inserindo nela.
//
// Não é regra de estilo — é a diferença entre uma migração e uma bomba-relógio
// com pavio do tamanho da janela de deploy.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIRETORIO = join(process.cwd(), "prisma", "migrations");

/**
 * Migrações já aplicadas que violam a regra, com o motivo. Entrada nova aqui
 * exige justificativa escrita — a lista existe para registrar história, não
 * para dar passagem.
 */
const PERDOADAS: Record<string, string> = {
  "20260813200000_contato_cadastro_completo":
    "É o incidente que originou esta regra. Consertado por " +
    "20260813210000_contato_atualizadoem_com_default, que acrescentou o DEFAULT. " +
    "Fica na lista, e não some do histórico, porque a janela de quebra existiu " +
    "de verdade — apagar o registro seria fingir que não.",

  // Ciclo 1a, Task 2: restaura "User"."papel" (ADD COLUMN nullable -> UPDATE
  // a partir de Membership -> SET NOT NULL, sem DEFAULT — o mesmo padrão do
  // incidente que esta regra existe para pegar). Isenção deliberada, não um
  // afrouxamento da regra:
  //
  // - POR QUE É SEGURO AQUI: este projeto não tem deploy nenhum publicado
  //   (ver docs/superpowers/plans do ciclo). A janela que o incidente
  //   descreve — código ANTIGO rodando contra schema NOVO, inserindo sem a
  //   coluna que acabou de virar NOT NULL — não existe neste repositório,
  //   porque migração e código sobem juntos (mesmo commit, mesmo deploy).
  //   Sem essa janela, não há INSERT concorrente para falhar com 23502.
  //
  // - POR QUE NÃO RESOLVEMOS COM DEFAULT (a correção que a regra pede): um
  //   DEFAULT em "papel" sobreviveria à migração e passaria a atribuir, em
  //   silêncio, um papel de autorização a todo INSERT em "User" que não
  //   informasse a coluna explicitamente — de um `Role` inventado (que valor
  //   seria "seguro" por padrão? nenhum: VENDEDOR sub-provisiona quem devia
  //   ser ADMIN, ADMIN super-provisiona o inverso). `User.papel` é
  //   exatamente a coluna que `hasPermission` lê — um DEFAULT aqui é menos
  //   óbvio que o de `companyId`, mas do mesmo gênero: atribuição silenciosa
  //   do lado errado de um controle de acesso. Pior ainda por esta migração
  //   ser NOMEADAMENTE temporária (ver o comentário do próprio arquivo): o
  //   plano é que uma tarefa futura corrija os leitores restantes
  //   (`core/audit/alerta.ts` e os testes listados) e DERRUBE "papel" de
  //   novo — um DEFAULT que sobrevivesse ficaria pendurado até lá, mascarando
  //   qualquer `User.create` que uma tarefa futura esquecesse de popular.
  //
  // - QUANDO ISTO DEIXA DE VALER: no dia em que o CRM for publicado, e
  //   também no dia em que a tarefa dedicada derrubar "User"."papel" de novo
  //   (o objetivo declarado desta migração ponte) — qualquer NOT NULL futuro
  //   nesta ou em outras tabelas vivas volta a precisar da regra sem
  //   isenção. A isenção é desta migração específica, não da regra.
  //
  // Alternativa considerada — DEFAULT acrescentado e DERRUBADO na mesma
  // migração, depois do backfill (o mesmo padrão que
  // 20260813210000_contato_atualizadoem_com_default usa, mas com um DROP
  // DEFAULT extra ao final) — reportada mas NÃO implementada aqui: exige
  // editar o SQL de uma migração já aplicada no banco de desenvolvimento
  // (checksum já gravado em `_prisma_migrations`), o que está fora do que
  // esta tarefa está autorizada a fazer sem aprovação explícita (ver
  // relatório desta tarefa, seção do item 1).
  "20260819140000_restaura_user_papel_temporariamente":
    "Restaura 'User'.'papel' (bridge temporária, Ciclo 1a Task 2) via " +
    "ADD COLUMN nullable -> UPDATE a partir de Membership -> SET NOT NULL, " +
    "sem DEFAULT. Sem janela de deploy neste projeto (migração e código " +
    "sobem juntos) para o 23502 que a regra evita, e um DEFAULT aqui " +
    "atribuiria papel de autorização em silêncio a qualquer INSERT futuro " +
    "que esquecesse a coluna — pior que a janela que estaria evitando. " +
    "Isenção desta migração, não da regra: volta a valer no dia do deploy " +
    "publicado, e a tarefa que derrubar 'papel' de novo (o objetivo desta " +
    "ponte) não herda a isenção.",
};

/** Comentário de SQL fala de `NOT NULL` em prosa; a regra vale para código. */
function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function tabelasCriadas(sql: string): Set<string> {
  const criadas = new Set<string>();
  for (const achado of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi)) {
    criadas.add(achado[1]);
  }
  return criadas;
}

type Violacao = { migracao: string; detalhe: string };

function analisar(migracao: string, sqlBruto: string): Violacao[] {
  const sql = semComentarios(sqlBruto);
  const criadas = tabelasCriadas(sql);
  const violacoes: Violacao[] = [];

  for (const comando of sql.split(";")) {
    const alter = comando.match(/ALTER TABLE\s+(?:ONLY\s+)?"([^"]+)"([\s\S]*)/i);
    if (!alter) continue;

    const [, tabela, corpo] = alter;
    if (criadas.has(tabela)) continue; // tabela nasceu nesta migração: sem linha antiga, sem código antigo

    // `ADD COLUMN ... NOT NULL` sem `DEFAULT` na mesma definição de coluna.
    const fragmentos = corpo.split(/ADD COLUMN/i).slice(1);
    for (const fragmento of fragmentos) {
      if (/NOT NULL/i.test(fragmento) && !/DEFAULT/i.test(fragmento)) {
        const nome = fragmento.match(/"([^"]+)"/)?.[1] ?? "?";
        violacoes.push({
          migracao,
          detalhe: `ADD COLUMN "${tabela}"."${nome}" NOT NULL sem DEFAULT`,
        });
      }
    }

    // `ALTER COLUMN ... SET NOT NULL` (o padrão de backfill em três passos):
    // o DEFAULT precisa aparecer em algum ponto da MESMA migração.
    for (const achado of corpo.matchAll(/ALTER COLUMN\s+"([^"]+)"\s+SET NOT NULL/gi)) {
      const coluna = achado[1];
      const temDefault = new RegExp(
        `ALTER COLUMN\\s+"${coluna}"\\s+SET DEFAULT`,
        "i"
      ).test(sql);
      if (!temDefault) {
        violacoes.push({
          migracao,
          detalhe: `SET NOT NULL em "${tabela}"."${coluna}" sem SET DEFAULT na mesma migração`,
        });
      }
    }
  }

  return violacoes;
}

function todasAsMigracoes(): { nome: string; sql: string }[] {
  return readdirSync(DIRETORIO, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => ({
      nome: entrada.name,
      caminho: join(DIRETORIO, entrada.name, "migration.sql"),
    }))
    .filter((m) => existsSync(m.caminho))
    .map((m) => ({ nome: m.nome, sql: readFileSync(m.caminho, "utf8") }));
}

describe("migrações", () => {
  it("o diretório de migrações é legível e tem conteúdo", () => {
    // Sem isto, um caminho errado faria TODOS os testes abaixo passarem por
    // não terem nada para analisar — o teste que não exercita nada.
    expect(todasAsMigracoes().length).toBeGreaterThan(5);
  });

  it("coluna NOT NULL nova em tabela existente sempre tem DEFAULT", () => {
    const violacoes = todasAsMigracoes()
      .filter((m) => PERDOADAS[m.nome] === undefined)
      .flatMap((m) => analisar(m.nome, m.sql));

    expect(
      violacoes.map((v) => `${v.migracao}: ${v.detalhe}`),
      "coluna NOT NULL sem DEFAULT numa tabela viva. O código publicado insere " +
        "sem essa coluna até o deploy sair, e todo INSERT falha com 23502 nessa " +
        "janela. Acrescente DEFAULT na mesma migração."
    ).toEqual([]);
  });

  it("a regra realmente pega o caso do incidente", () => {
    // Prova de que o analisador não é decorativo: o SQL exato que quebrou
    // produção precisa ser reprovado por ele. Sem esta asserção, um erro de
    // regex deixaria a lista de violações sempre vazia e o teste acima verde
    // para sempre.
    const doIncidente = `
      ALTER TABLE "Contact" ADD COLUMN "atualizadoEm" TIMESTAMP(3);
      UPDATE "Contact" SET "atualizadoEm" = "criadoEm";
      ALTER TABLE "Contact" ALTER COLUMN "atualizadoEm" SET NOT NULL;
    `;
    expect(analisar("teste", doIncidente)).toHaveLength(1);

    // E a versão consertada precisa passar.
    const consertado = `${doIncidente}
      ALTER TABLE "Contact" ALTER COLUMN "atualizadoEm" SET DEFAULT CURRENT_TIMESTAMP;
    `;
    expect(analisar("teste", consertado)).toHaveLength(0);
  });

  it("tabela criada na própria migração pode ter NOT NULL sem DEFAULT", () => {
    // O caso legítimo: não existe linha antiga nem código antigo inserindo
    // numa tabela que nasce agora. Marcar isto como violação encheria a
    // lista de ruído e treinaria todo mundo a ignorá-la.
    const nova = `
      CREATE TABLE "Novidade" ("id" TEXT NOT NULL, "nome" TEXT NOT NULL);
      ALTER TABLE "Novidade" ADD COLUMN "extra" TEXT NOT NULL;
    `;
    expect(analisar("teste", nova)).toHaveLength(0);
  });

  it("prosa em comentário não conta como SQL", () => {
    const sóComentario = `
      -- ALTER TABLE "Contact" ALTER COLUMN "x" SET NOT NULL sem default seria ruim
      SELECT 1;
    `;
    expect(analisar("teste", sóComentario)).toHaveLength(0);
  });
});
