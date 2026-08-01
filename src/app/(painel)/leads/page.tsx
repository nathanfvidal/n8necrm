import { prisma } from "@/lib/prisma";
import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { LeadForm } from "@/components/leads/lead-form";
import { LeadTable, type LeadLinha } from "@/components/leads/lead-table";
import { listarLeads } from "@/core/leads/queries";
import { EmptyState } from "@/components/empty-state";

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

  // Reaproveita a MESMA fronteira de `ver_dashboard_geral` usada acima para
  // decidir quem recebe a lista de vendedores: quem não tem essa permissão
  // (VENDEDOR) só enxerga, na tabela, os leads dos quais é o próprio
  // responsável. Sem esta restrição, a tabela desfaria em leitura o que
  // Task 13/14 já protegem em escrita — um VENDEDOR não pode ATRIBUIR lead
  // a outra pessoa nem ver o NOME de outros vendedores no formulário, mas
  // conseguiria ver o TELEFONE de todo cliente da empresa, de qualquer
  // vendedor, numa lista. A restrição é aplicada aqui, no `where` de
  // `listarLeads` (Task 16) — server-side, antes de qualquer linha sair do
  // banco — não como um `.filter()` no componente cliente, que só
  // esconderia visualmente dados que já teriam trafegado até o navegador
  // (não é uma permissão de verdade).
  //
  // Esta mesma decisão vale para a exportação CSV (Task 21): o mesmo filtro
  // por `responsavelId` precisa se aplicar lá, pelo mesmo motivo — a
  // planilha exportada por um VENDEDOR não pode conter telefone/nome de
  // clientes de outros vendedores.
  const leads = await listarLeads(podeAtribuirOutraPessoa ? {} : { responsavelId: usuario.id });

  const linhas: LeadLinha[] = leads.map((lead) => ({
    id: lead.id,
    // Mesma redação de "sem dado" do card do kanban (Task 15) — um lead
    // originado de clique no WhatsApp pode não ter contato identificado
    // ainda (`lead.contact` nullable, Task 13).
    contatoNome: lead.contact?.nome ?? "Sem contato identificado",
    telefone: lead.contact?.telefone ?? null,
    etapaNome: lead.stage.nome,
    responsavelNome: lead.responsavel?.nome ?? "Sem responsável",
    canal: lead.canal,
    criadoEm: lead.criadoEm.toLocaleDateString("pt-BR"),
    criadoEmISO: lead.criadoEm.toISOString().slice(0, 10),
  }));

  const etapasUnicas = [...new Set(linhas.map((linha) => linha.etapaNome))];
  const responsaveisUnicos = [...new Set(linhas.map((linha) => linha.responsavelNome))];

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Leads</h1>
      <LeadForm
        responsavelPadraoId={usuario.id}
        nomeUsuario={usuario.nome}
        vendedores={vendedores}
        podeAtribuirOutraPessoa={podeAtribuirOutraPessoa}
      />
      {linhas.length === 0 ? (
        <EmptyState
          title="Nenhum lead ainda"
          description="Use o formulário acima para adicionar o primeiro."
        />
      ) : (
        <LeadTable dados={linhas} etapas={etapasUnicas} responsaveis={responsaveisUnicos} />
      )}
    </div>
  );
}
