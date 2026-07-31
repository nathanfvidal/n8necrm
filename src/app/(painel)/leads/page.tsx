import { prisma } from "@/lib/prisma";
import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { LeadForm } from "@/components/leads/lead-form";

/**
 * `(painel)/layout.tsx` já chama `usuarioAtual()` e redireciona para
 * `/login` quando ela rejeita (sessão ausente OU usuário desativado) — esta
 * página não repete essa checagem. Chamar `usuarioAtual()` de novo aqui não
 * é redundante por segurança (o layout já protege a rota); é como esta
 * página descobre QUEM está logado, para saber o `responsavelId` padrão do
 * formulário e decidir se busca a lista de vendedores abaixo.
 */
export default async function LeadsPage() {
  const usuario = await usuarioAtual();

  // Só ADMIN e GESTOR (ação `ver_dashboard_geral`) conseguem atribuir um
  // lead a outra pessoa — `criarLeadManual` clampa `responsavelId` no
  // servidor para o próprio autor quando quem chama não tem essa permissão
  // (ver actions.ts, Task 13). Por isso um VENDEDOR nem recebe a lista de
  // outros usuários aqui: oferecer no formulário uma escolha que o servidor
  // vai descartar em silêncio seria enganoso, e buscar dados de outras
  // contas que a pessoa não pode usar não tem propósito.
  const podeAtribuirOutraPessoa = hasPermission(usuario.papel, "ver_dashboard_geral");

  const vendedores = podeAtribuirOutraPessoa
    ? await prisma.user.findMany({
        where: { ativo: true },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      })
    : [];

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Leads</h1>
      <LeadForm
        responsavelPadraoId={usuario.id}
        nomeUsuario={usuario.nome}
        vendedores={vendedores}
        podeAtribuirOutraPessoa={podeAtribuirOutraPessoa}
      />
    </div>
  );
}
