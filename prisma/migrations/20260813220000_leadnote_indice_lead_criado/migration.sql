-- Índice de `LeadNote` para a consulta que a tela de detalhe do lead faz.
--
-- `listarNotas` (`core/leads/notes.ts`) filtra por `leadId` e ordena por
-- `criadoEm desc`. As duas colunas juntas servem filtro e ordenação na mesma
-- varredura; com só `leadId`, o Postgres encontra as linhas e ordena à parte.
--
-- ## Honestidade sobre o ganho
--
-- Nesta escala (uma revenda com ~500 leads e poucas notas por lead) a
-- diferença NÃO é mensurável, e dizer o contrário seria inventar justificativa.
-- É seguro barato numa tabela que só cresce e nunca encolhe: o custo é uma
-- estrutura pequena e uma escrita marginalmente mais lenta em `INSERT`, contra
-- uma consulta que já está no caminho de toda abertura de `/leads/[id]`.
--
-- Sem `NOT NULL` novo, sem coluna nova, sem tabela nova — então sem `DEFAULT`
-- a acertar (ver `tests/unit/migracoes-seguras.test.ts`) e sem migração
-- companheira de RLS/REVOKE.

CREATE INDEX "LeadNote_leadId_criadoEm_idx" ON "LeadNote"("leadId", "criadoEm");
