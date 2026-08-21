-- Ciclo 1e, Task 1: Contact.telefone deixa de ser unico GLOBAL.
--
-- POR QUE: duas empresas atendendo o mesmo cliente e o caso NORMAL de um CRM
-- multi-empresa. Com o unico global, a segunda empresa a cadastrar o numero
-- levava P2002, e o codigo carregava um ramo inteiro so para explicar isso
-- (src/core/leads/dedupe.ts) alem de um segundo ramo de mensagem em
-- src/core/contacts/service.ts. Os dois viram defesa contra corrida.
--
-- POR QUE SEM DEDUPLICACAO: a chave nova e a antiga MAIS uma coluna, entao
-- nenhuma linha que ja passava na antiga pode colidir na nova. Medido em
-- 2026-08-20 antes desta migracao: Contact = 4 linhas, Company = 1, e
-- GROUP BY ("companyId", telefone) HAVING count(*) > 1 devolveu vazio.
--
-- POR QUE NAO ACIONA tests/unit/migracoes-seguras.test.ts: aquela guarda pega
-- ADD COLUMN ... NOT NULL sem DEFAULT e ALTER COLUMN ... SET NOT NULL sem
-- DEFAULT na mesma migracao. Aqui nao ha coluna nova nem coluna virando NOT
-- NULL -- so troca de indice. PERDOADAS nao recebe entrada nenhuma.
--
-- POR QUE SEM CONCURRENTLY: 4 linhas. CONCURRENTLY nao roda dentro da
-- transacao que o prisma migrate abre, e o ganho aqui seria zero.

-- DropIndex
DROP INDEX "Contact_telefone_key";

-- CreateIndex
CREATE UNIQUE INDEX "Contact_companyId_telefone_key" ON "Contact"("companyId", "telefone");
