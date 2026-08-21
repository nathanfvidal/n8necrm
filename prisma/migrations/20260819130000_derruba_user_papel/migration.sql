-- Ciclo 1a, Task 2 (parte 2): derruba "User"."papel".
--
-- A coluna sobreviveu à migração anterior (20260819120000_tenancy_company_
-- membership) de propósito: derrubá-la ali regeneraria o client do Prisma sem
-- "papel" antes de "usuarioAtual()" e os leitores existentes pararem de lê-la
-- -- o repositório ficaria quebrado entre duas tarefas.
--
-- Nesta tarefa, dois leitores que o plano original não previa foram
-- encontrados e corrigidos primeiro (fora deste arquivo, nos commits
-- anteriores desta mesma tarefa):
--   1. `src/core/auth/credenciais.ts` devolvia `role: user.papel` para o JWT
--      -- morto (medido: nada em `src/` lê `session.user.role`/`token.role`).
--   2. `src/core/users/service.ts` e `queries.ts` (24 + 2 referências)
--      liam/gravavam `User.papel` na tela de gestão de equipe -- passaram a
--      operar em `Membership`, na empresa de quem age.
--
-- Só com os dois corrigidos é seguro derrubar a coluna: nada no código
-- continua lendo `User.papel` a partir daqui.

-- ============================================================================
-- Verificação ANTES do DROP: não derruba `User.papel` sem provar que ninguém
-- perde o papel.
--
-- A alternativa considerada e descartada era manter a coluna por um ciclo,
-- "para divergência ser detectável". Detectável por quem? Nada iria conferir.
-- Duas fontes de verdade para AUTORIZAÇÃO não são rede de segurança, são a
-- falha esperando alguém ler a errada. Aqui a conferência acontece no único
-- momento em que ainda dá para desfazer: antes do DROP, dentro da transação
-- da migração (o Prisma envolve cada migration.sql numa transação por
-- padrão em Postgres).
-- ============================================================================

DO $$
DECLARE
  faltando integer;
BEGIN
  SELECT count(*) INTO faltando
  FROM "User" u
  WHERE NOT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = u.id AND m.papel = u.papel
  );

  IF faltando > 0 THEN
    RAISE EXCEPTION
      'Abortando: % usuario(s) sem Membership com o papel que User.papel declara. Nada foi apagado.',
      faltando;
  END IF;
END $$;

-- ============================================================================
-- Só chega aqui se a verificação acima passou.
-- ============================================================================

-- AlterTable
ALTER TABLE "User" DROP COLUMN "papel";
