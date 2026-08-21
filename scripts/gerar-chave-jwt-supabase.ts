import { gerarParDeChaves } from "../src/core/supabase-jwt/chave";

/**
 * Gera o par ES256 do CRM e imprime as duas metades. Não grava nada em disco.
 *
 * Quem roda isto é o DONO do projeto, não um agente: a saída contém a chave que
 * assina todo token deste CRM, e ela não pode passar por transcrição de sessão
 * nem por log de ferramenta.
 */
async function principal() {
  const { privado, publico } = await gerarParDeChaves();

  console.log("\n=== 1. .env (NUNCA com prefixo NEXT_PUBLIC_) ===\n");
  console.log(`SUPABASE_JWT_PRIVATE_JWK='${JSON.stringify(privado)}'`);
  console.log("\n=== 2. JWKS público — para `custom_jwks` no registro do Supabase ===\n");
  console.log(JSON.stringify({ keys: [publico] }));
  console.log(`\nkid: ${privado.kid}\n`);
  console.log(
    "Em produção, em vez de custom_jwks, registre jwks_url apontando para\n" +
      "https://<origem-do-crm>/api/jwks — e apague o registro de dev ANTES,\n" +
      "porque um provider de dev registrado minta token válido em produção.\n"
  );
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
