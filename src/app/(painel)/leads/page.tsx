import { prisma } from "@/lib/prisma";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { LeadForm } from "@/components/leads/lead-form";
import { LeadTable, type LeadLinha } from "@/components/leads/lead-table";
import { listarLeads } from "@/core/leads/queries";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { dataISOEmSaoPaulo, formatarDataBR } from "@/lib/date";

/**
 * `(painel)/layout.tsx` já chama `usuarioAtual()` e redireciona para
 * `/login` quando ela rejeita (sessão ausente OU usuário desativado) — esta
 * página não repete essa checagem. Chamar `usuarioAtual()` de novo aqui não
 * é redundante por segurança (o layout já protege a rota); é como esta
 * página descobre QUEM está logado, para saber o `responsavelId` padrão do
 * formulário e decidir se busca a lista de vendedores abaixo.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ arquivados?: string }>;
}) {
  const usuario = await usuarioAtualOuLogin();

  // Sem este alternador, arquivar seria mão única: o lead some das quatro
  // listagens e não existe caminho para encontrá-lo e chamar
  // `desarquivarLead`. A autorrevisão da spec pegou justamente isso.
  //
  // `?arquivados=1` no molde do `?q=` da busca de contatos — `<form
  // method="get">`, sem estado no cliente: o estado do filtro fica na URL,
  // que é compartilhável e sobrevive a um recarregamento.
  const mostrarArquivados = (await searchParams).arquivados === "1";

  // Só ADMIN e GESTOR (ação `ver_dashboard_geral`) conseguem atribuir um
  // lead a outra pessoa — `criarLeadManual` clampa `responsavelId` no
  // servidor para o próprio autor quando quem chama não tem essa permissão
  // (ver actions.ts, Task 13). Por isso um VENDEDOR nem recebe a lista de
  // outros usuários aqui: oferecer no formulário uma escolha que o servidor
  // vai descartar em silêncio seria enganoso, e buscar dados de outras
  // contas que a pessoa não pode usar não tem propósito.
  const podeAtribuirOutraPessoa = hasPermission(usuario.papel, "ver_dashboard_geral");

  // `GET /export/leads` (Task 21) já checa `exportar_leads` no servidor
  // independente do que acontece aqui — este flag só decide se o botão
  // aparece. ADMIN e GESTOR têm a permissão; VENDEDOR não (ver matriz em
  // core/auth/permissions.ts). Sem essa checagem, um VENDEDOR veria um link
  // que sempre resolve em 403 — pior que não oferecer a ação.
  const podeExportar = hasPermission(usuario.papel, "exportar_leads");

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
  const leads = await listarLeads({ incluirArquivados: mostrarArquivados });

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
    // Mesmo fuso (São Paulo) para o rótulo exibido e para a chave usada no
    // filtro "De"/"Até" (lead-table.tsx) — de propósito, ver comentário de
    // `dataISOEmSaoPaulo` em `@/lib/date`: usar fusos diferentes para os
    // dois é o bug que fazia "filtrar por 04/08" não achar uma linha
    // rotulada "04/08" perto da virada da meia-noite.
    criadoEm: formatarDataBR(lead.criadoEm),
    criadoEmISO: dataISOEmSaoPaulo(lead.criadoEm),
    arquivado: lead.arquivadoEm !== null,
  }));

  const etapasUnicas = [...new Set(linhas.map((linha) => linha.etapaNome))];
  const responsaveisUnicos = [...new Set(linhas.map((linha) => linha.responsavelNome))];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <div className="flex items-center gap-3">
          {/* `<form method="get">` sem JS: o próprio navegador monta a URL.
              O `<input type="hidden">` só existe quando o filtro está
              desligado — é o que faz o botão alternar nos dois sentidos, já
              que um campo ausente some da query string. */}
          <form method="get" className="flex items-center">
            {!mostrarArquivados && <input type="hidden" name="arquivados" value="1" />}
            <button type="submit" className="text-sm underline">
              {mostrarArquivados ? "Ocultar arquivados" : "Mostrar arquivados"}
            </button>
          </form>
          {podeExportar && (
          // Link nativo, não `router.push`/`onClick` com `fetch`: a rota
          // devolve `Content-Disposition: attachment` (Task 21), então o
          // próprio navegador trata a navegação como download e permanece
          // em `/leads` — não precisa de `target="_blank"` (abriria uma aba
          // em branco à toa) nem de JS extra para disparar o download.
            <a href="/export/leads" className={buttonVariants({ variant: "outline" })}>
              Exportar CSV
            </a>
          )}
        </div>
      </div>
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
