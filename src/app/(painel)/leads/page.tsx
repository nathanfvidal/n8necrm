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

  // Fix round 1/5: a versão original desta página restringia `listarLeads`
  // por `responsavelId` para quem não tem `ver_dashboard_geral` (VENDEDOR).
  // O revisor achou que essa restrição era genuína dentro de `/leads`, mas
  // inútil na prática — `/leads/kanban` (Task 15) já lista TODO lead para
  // TODO papel sem filtro nenhum, e `moverEtapa` (service.ts) nunca checou
  // dono, então qualquer VENDEDOR conseguia ver e mover o lead "escondido"
  // pelo board, a um clique de distância da tabela. Uma barreira que existe
  // numa tela e não na outra não é controle, é falsa confiança. Decisão de
  // produto (não deste código): esta é uma revenda pequena, a equipe
  // trabalha de forma colaborativa, e qualquer vendedor pode precisar do
  // histórico de um lead que "pertence" a outro para atender um cliente que
  // chegou na loja. `listarLeads()` voltou a listar todo lead para todo
  // papel — mesmo comportamento do kanban, sem escopo por responsável.
  const leads = await listarLeads();

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
