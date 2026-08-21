-- Ciclo 1e, Task 4: WhatsappMessage.idExterno deixa de ser unico GLOBAL.
--
-- A FUNCAO DA CHAVE NAO MUDA: deduplicar reentrega. A Evolution reentrega em
-- caso de erro, e idExterno (data.key.id) e o que faz a mesma mensagem,
-- entregue duas vezes, nao virar duas linhas. Frouxa demais, mensagem duplica;
-- apertada demais, a dedup para de funcionar e o cliente recebe a resposta
-- repetida. Por isso a mudanca e de ESCOPO, nunca de existencia.
--
-- POR QUE companyId E NAO conversationId: a chave tem de casar com a consulta
-- que a le. O catch de P2002 em ingest.ts faz findFirst({ where: { idExterno } })
-- num cliente ESCOPADO -- WHERE "companyId" = $1 AND "idExterno" = $2. Uma
-- chave por conversationId permitiria o mesmo idExterno duas vezes na mesma
-- empresa, aquele findFirst devolveria uma linha arbitraria, e o
-- findFirstOrThrow seguinte devolveria a conversa ERRADA para o job de fila.
-- Dedup "funcionando" com roteamento quebrado e pior que dedup falhando alto.
--
-- POR QUE NAO CONTINUAR GLOBAL: a unidade de reentrega e a ENTREGA, e a entrega
-- se resolve em empresa (o webhook chega por uma WhatsappConnection, que tem
-- companyId). Global fazia o id de uma mensagem da empresa B bloquear a
-- gravacao de uma mensagem da A. Alem disso gateway/evolution.ts inventa
-- evolution-sem-id-<uuid> quando o payload nao traz key.id: confiar em
-- unicidade global de um id de terceiro e a suposicao que este ciclo desfaz.
--
-- POR QUE SEM DEDUPLICACAO: medido em 2026-08-20 contra o Postgres 17.6 deste
-- projeto, WhatsappMessage = 0 linhas, e nenhum par (companyId, idExterno)
-- repetido.
--
-- POR QUE NAO ACIONA tests/unit/migracoes-seguras.test.ts: nao ha ADD COLUMN
-- nem SET NOT NULL. PERDOADAS nao recebe entrada.

-- DropIndex
DROP INDEX "WhatsappMessage_idExterno_key";

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_companyId_idExterno_key" ON "WhatsappMessage"("companyId", "idExterno");
