-- Ciclo 1e, Task 3: Conversation.waId deixa de ser unico GLOBAL.
--
-- POR QUE, E POR QUE AGORA: enquanto EVOLUTION_COMPANY_ID era constante do
-- deploy, a segunda empresa era inalcancavel e o defeito era teoria. O Ciclo 2a
-- matou a variavel -- o webhook resolve a empresa pela CONEXAO -- e o mesmo
-- numero atendido por duas empresas passou a colidir em P2002, virar 500, e
-- fazer a Evolution reentregar para sempre. O laco nao tem saida por si: o
-- findFirst de ingest.ts e escopado e nunca acha a conversa da outra empresa.
-- Fonte: docs/auditorias/2026-08-20-ciclo-2a-cofre-credenciais.md, secao 6.
--
-- POR QUE connectionId NAO ENTRA NA CHAVE (decisao de produto, 4.3 do spec):
-- uma empresa com dois numeros recebendo o mesmo cliente tem UMA conversa.
-- Conversation carrega estado (iaAtiva, iaPausadaPor, aguardandoHumanoDesde,
-- contactId, leadId) e duplica-la duplicaria a pausa da IA -- humano assume de
-- um lado, bot continua respondendo do outro. Alem disso connectionId e
-- anulavel, e NULL e distinto de NULL num indice unico do Postgres: com ele na
-- chave, duas linhas com o mesmo waId e connectionId nulo passariam as duas.
--
-- POR QUE SEM DEDUPLICACAO E SEM BACKFILL: medido em 2026-08-20 contra o
-- Postgres 17.6 deste projeto, Conversation = 0 linhas (e 0 com connectionId
-- nulo). Nao ha o que fundir. E por isso que este ciclo e agora: depois de
-- existir historico de conversa, a mesma mudanca vira migracao com decisao de
-- fusao de historico.
--
-- POR QUE NAO ACIONA tests/unit/migracoes-seguras.test.ts: nao ha ADD COLUMN
-- nem SET NOT NULL. Em particular NAO tornamos connectionId NOT NULL -- isso
-- acionaria a guarda, e um DEFAULT numa FK de conexao penduraria conversas numa
-- conexao arbitraria, exatamente o argumento que a entrada
-- 20260819140000_restaura_user_papel_temporariamente ja usa. PERDOADAS nao
-- recebe entrada.

-- DropIndex
DROP INDEX "Conversation_waId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_companyId_waId_key" ON "Conversation"("companyId", "waId");
