-- Ciclo 1a, Task 2 (parte 2): RESTAURA "User"."papel", que a migração
-- anterior (20260819130000_derruba_user_papel) derrubou.
--
-- O DROP daquela migração passou na verificação de integridade (nenhum
-- usuário ficaria sem papel), mas isso só provava que os dados estavam
-- seguros — não que nada mais lia a coluna. Depois de aplicada, o
-- `npm run typecheck` do repositório inteiro (não só dos arquivos desta
-- tarefa) revelou um TERCEIRO grupo de leitores de `User.papel` que nem o
-- plano original nem esta tarefa previram:
--
--   - `src/core/audit/alerta.ts` (PRODUÇÃO): a lista de destinatários do
--     alerta de rajada destrutiva (`enviarAlertaSeNecessario`) consulta
--     `prisma.user.findMany({ where: { papel: "ADMIN", ... } })` para achar
--     quem notificar. Não é teste — é a feature de segurança que avisa
--     administradores quando alguém apaga/arquiva muita coisa rápido demais.
--   - Mais 3 arquivos de e2e (`tests/e2e/global-setup.ts`,
--     `sessao-e-cache.spec.ts`, `whatsapp-agente.spec.ts`) e 17 arquivos de
--     teste unitário (audit-log, contacts, leads, notifications, pipeline,
--     tasks, whatsapp — ver relatório desta tarefa para a lista completa)
--     criam ou consultam `User` esperando a coluna `papel`.
--
-- Corrigir `alerta.ts` é uma decisão de escopo (companyId ainda não chega até
-- lá) que esta tarefa não estava autorizada a tomar sozinha — o brief pede
-- explicitamente para PARAR e reportar ao encontrar um terceiro leitor não
-- previsto, o mesmo que já aconteceu duas vezes neste ciclo. Restaurar a
-- coluna devolve o repositório a um estado que compila e testa, e o DROP
-- fica pendente de uma tarefa dedicada a migrar esses leitores para
-- `Membership` primeiro.
--
-- Backfill a partir de `Membership`: no momento desta migração, todo `User`
-- tem exatamente um `Membership` (confirmado: 4 usuários, 4 vínculos) — não
-- há ambiguidade em qual papel copiar de volta. `src/core/users/service.ts`
-- passou a gravar nas DUAS colunas (dual-write) enquanto este bridge existir,
-- para que `User.papel` continue correto também para pessoas criadas/editadas
-- DEPOIS desta restauração — não só para quem já existia.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "papel" "Role";

-- Backfill
UPDATE "User" u
SET "papel" = m."papel"
FROM "Membership" m
WHERE m."userId" = u.id;

-- SetNotNull
ALTER TABLE "User" ALTER COLUMN "papel" SET NOT NULL;
