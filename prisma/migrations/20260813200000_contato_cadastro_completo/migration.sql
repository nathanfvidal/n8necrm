-- `Contact` deixa de ser nome+telefone+email e vira cadastro de pessoa.
--
-- ## Por que este arquivo é escrito à mão
--
-- O SQL que o `migrate diff` gera para `atualizadoEm` é:
--
--   ALTER TABLE "Contact" ADD COLUMN "atualizadoEm" TIMESTAMP(3) NOT NULL;
--
-- e isso FALHA numa tabela com linhas — não há valor para as existentes.
-- Medido antes de escrever: 5 contatos no banco. Não é risco teórico.
--
-- ## Por que o backfill usa `criadoEm`, e não `now()`
--
-- `DEFAULT CURRENT_TIMESTAMP` carimbaria todo contato antigo como "atualizado
-- hoje", que é mentira — e mentira gravada em coluna de auditoria é pior que
-- coluna ausente, porque parece resposta. `criadoEm` é a única verdade
-- disponível sobre quando aquela linha foi tocada pela última vez.
--
-- ## O que este arquivo NÃO precisa fazer
--
-- Nenhuma tabela nova ⇒ nenhuma migração companheira de RLS/REVOKE. A
-- `Contact` já existe, já tem RLS ligada e já não concede nada a
-- `anon`/`authenticated`; `ALTER TABLE ... ADD COLUMN` não mexe em nenhuma das
-- duas coisas. Quem quiser conferir em vez de acreditar:
-- `tests/e2e/banco-blindado.spec.ts` roda as quatro invariantes contra o banco
-- de verdade.

-- Colunas do cadastro. Todas nullable: a agenda existente não tem esses dados,
-- e exigir preenchimento retroativo travaria a edição de qualquer contato
-- antigo no primeiro salvamento.
ALTER TABLE "Contact"
  ADD COLUMN "empresa" TEXT,
  ADD COLUMN "cargo" TEXT,
  ADD COLUMN "documento" TEXT,
  ADD COLUMN "endereco" TEXT,
  ADD COLUMN "cidade" TEXT,
  ADD COLUMN "uf" CHAR(2),
  ADD COLUMN "observacoes" TEXT,
  ADD COLUMN "atualizadoEm" TIMESTAMP(3);

UPDATE "Contact" SET "atualizadoEm" = "criadoEm" WHERE "atualizadoEm" IS NULL;

ALTER TABLE "Contact" ALTER COLUMN "atualizadoEm" SET NOT NULL;

-- Ordenação padrão da agenda (`listarContatos` ordena por `criadoEm desc`).
-- Não é índice de busca: `ILIKE '%termo%'` não é servido por btree.
CREATE INDEX "Contact_criadoEm_idx" ON "Contact"("criadoEm");
