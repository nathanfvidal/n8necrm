import Link from "next/link";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { listarContatos } from "@/core/contacts/queries";
import { LIMITE_LISTAGEM } from "@/core/listagem";
import { ContactForm } from "@/components/contacts/contact-form";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatarDataHoraBR } from "@/lib/date";

/**
 * Agenda de contatos.
 *
 * Existe porque, até esta fatia, `Contact` só nascia pendurado num lead: não
 * havia como listar as pessoas, corrigir um telefone digitado errado, nem
 * responder "quem é essa pessoa e o que já aconteceu com ela".
 *
 * Sem gate de permissão além da sessão: o projeto já decidiu que todos os
 * papéis veem e trabalham todos os leads, e contato é o outro lado do mesmo
 * dado. O `try/catch` em volta de `usuarioAtual()` espelha
 * `(painel)/layout.tsx` — o Next renderiza layout e página em paralelo, então
 * uma sessão que morre no meio pode alcançar esta página com o layout já a
 * caminho do redirecionamento, e sem isto a rejeição vira tela de erro
 * genérica em vez de ir para o login.
 *
 * A busca vive na URL (`?q=`) em vez de estado de componente: assim o
 * resultado é compartilhável, sobrevive a um F5, e o filtro roda no Postgres
 * em vez de carregar a agenda inteira para filtrar no navegador — que é o que
 * a tabela de leads faz e só se sustenta porque a Fase 1 tem poucos leads.
 */
export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await usuarioAtualOuLogin();

  const { q } = await searchParams;
  const busca = q?.trim() ?? "";
  const { itens: contatos, truncado } = await listarContatos(busca);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Contatos</h1>
        <p className="text-sm text-muted-foreground">
          As pessoas do outro lado dos leads e das conversas.
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-3 text-sm font-medium">Adicionar contato</h2>
        <ContactForm />
      </div>

      {/* `<form method="get">` sem JavaScript: a busca é uma navegação, não
          uma interação — funciona com JS desligado e deixa o resultado na URL. */}
      <form method="get" className="flex items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={busca}
            placeholder="Nome, empresa, telefone ou e-mail"
          />
        </div>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
        {busca && (
          <Link href="/contatos" className="text-sm text-muted-foreground underline">
            Limpar
          </Link>
        )}
      </form>

      {/* Truncamento nunca em silêncio: sem este aviso, quem abre a agenda
          conclui que ela tem exatamente o número de linhas mostradas. Aqui a
          saída é a busca logo acima, que filtra no banco e não na tela. */}
      {truncado && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          Mostrando os {LIMITE_LISTAGEM} contatos mais recentes. Há mais no banco — use a busca
          acima para encontrar alguém específico.
        </p>
      )}
      {contatos.length === 0 ? (
        <EmptyState
          title={busca ? "Nenhum contato encontrado" : "Nenhum contato ainda"}
          description={
            busca
              ? "Tente outro nome, telefone ou e-mail."
              : "Contatos aparecem aqui quando você cadastra um, ou quando um lead é criado."
          }
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">Nome</th>
              {/* Empresa logo depois do nome: num CRM B2B é o que distingue
                  dois "Carlos" na agenda. É o único campo do cadastro que sobe
                  para a lista — ver `ContatoListado` para o porquê dos outros
                  ficarem de fora. */}
              <th className="py-2 font-medium">Empresa</th>
              <th className="py-2 font-medium">Telefone</th>
              <th className="py-2 font-medium">E-mail</th>
              <th className="py-2 font-medium">Leads</th>
              <th className="py-2 font-medium">Desde</th>
            </tr>
          </thead>
          <tbody>
            {contatos.map((contato) => (
              <tr key={contato.id} className="border-b hover:bg-muted/40">
                <td className="py-2">
                  <Link href={`/contatos/${contato.id}`} className="text-primary underline">
                    {contato.nome}
                  </Link>
                </td>
                <td className="py-2 text-muted-foreground">{contato.empresa ?? "—"}</td>
                <td className="py-2">{contato.telefone}</td>
                <td className="py-2 text-muted-foreground">{contato.email ?? "—"}</td>
                <td className="py-2">{contato.totalLeads}</td>
                <td className="py-2 text-muted-foreground">{formatarDataHoraBR(contato.criadoEm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
