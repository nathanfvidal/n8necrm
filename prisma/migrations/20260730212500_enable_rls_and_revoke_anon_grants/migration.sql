-- Defense in depth against Supabase's PostgREST gateway, which sits in
-- front of this Postgres cluster regardless of how the application itself
-- connects (this app connects as the table owner via a direct
-- DATABASE_URL/postgres role, which bypasses RLS unless FORCE ROW LEVEL
-- SECURITY is set -- it is intentionally NOT set here).
--
-- Supabase's default `GRANT ALL ... TO anon, authenticated` on newly
-- created tables in the `public` schema means every table below is,
-- by default, readable/writable/truncatable through the public REST API
-- using nothing but the project's public anon key. Two independent layers
-- close that off:
--
--   1. ENABLE ROW LEVEL SECURITY with no policies defined -> default-deny
--      for every role that is not the table owner.
--   2. REVOKE the anon/authenticated grants outright -> even if RLS is
--      ever accidentally disabled on a table, PostgREST gets a permission
--      error instead of silently falling through to unrestricted access.
--
-- No policies are created because nothing in this application is meant to
-- be reachable through the anon/authenticated PostgREST path today.

-- CreateRLS
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimit" ENABLE ROW LEVEL SECURITY;

-- RevokeAnonAndAuthenticatedGrants
REVOKE ALL ON TABLE "User" FROM anon, authenticated;
REVOKE ALL ON TABLE "Contact" FROM anon, authenticated;
REVOKE ALL ON TABLE "PipelineStage" FROM anon, authenticated;
REVOKE ALL ON TABLE "Lead" FROM anon, authenticated;
REVOKE ALL ON TABLE "LeadNote" FROM anon, authenticated;
REVOKE ALL ON TABLE "Task" FROM anon, authenticated;
REVOKE ALL ON TABLE "Notification" FROM anon, authenticated;
REVOKE ALL ON TABLE "AuditLog" FROM anon, authenticated;
REVOKE ALL ON TABLE "RateLimit" FROM anon, authenticated;

-- CreateRLSAndRevokeOnPrismaBookkeepingTable
-- "_prisma_migrations" is created by the Prisma migration engine itself
-- (not by any migration file), so it does not exist yet inside the
-- temporary shadow database Prisma uses to validate this migration --
-- a direct ALTER TABLE/REVOKE against it fails shadow validation on every
-- fresh clone. Guard it so the statement is a no-op there and a real
-- fix on every database where the table has actually been created
-- (i.e. every real dev/staging/prod database, immediately after `prisma
-- migrate deploy` has run at least once).
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM anon, authenticated';
  END IF;
END $$;
