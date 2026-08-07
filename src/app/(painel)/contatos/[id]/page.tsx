import Link from "next/link";
import { notFound } from "next/navigation";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { buscarContatoComHistorico } from "@/core/contacts/queries";
import { moduloAtivo } from "@/lib/module-gate";
import { listarConversasDoContato } from "@/modules/whatsapp/queries";
import { ContactForm } from "@/components/contacts/contact-form";
import { EmptyState } from "@/components/empty-state";
import { formatarDataHoraBR } from "@/lib/date";

/**
 * Detalhe de um contato: dados editáveis, leads e conversas da pessoa.
 *
 * ## A seção de conversas e a fronteira core/modules
 *
 * `Conversation` é conceito do módulo `whatsapp`, então a consulta mora lá
 * (`listarConversasDoContato`), não em `core/contacts/queries.ts` — `src/core`
 * não pode importar de `src/modules`, e a regra de ESLint quebra o build se
 * alguém tentar. Esta página vive em `src/app/`, que pode importar dos dois
 * lados, e é o lugar certo para costurar os dois.
 *
 * O import de `@/modules/whatsapp/queries` é ESTÁTICO e a chamada é
 * condicional. Num fork com o módulo desligado, o código continua no bundle
 * do servidor mas a tabela nunca é consultada e a seção não aparece — que é o
 * comportamento que importa. Import dinâmico só para evitar código morto no
 * servidor não pagaria a complexidade.
 */
export default async function ContatoPage({ params }: { params: Promise<{ id: string }> }) {
  await usuarioAtualOuLogin();

  const { id } = await params;
  const contato = await buscarContatoComHistorico(id);
  if (!contato) notFound();

  const mostrarConversas = moduloAtivo("whatsapp");
  const conversas = mostrarConversas ? await listarConversasDoContato(contato.id) : [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/contatos" className="text-sm text-muted-foreground hover:underline">
          ← Contatos
        </Link>
        <h1 className="text-xl font-semibold">{contato.nome}</h1>
        <p className="text-sm text-muted-foreground">
          Na agenda desde {formatarDataHoraBR(contato.criadoEm)}
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-3 text-sm font-medium">Dados</h2>
        <ContactForm contato={contato} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Leads ({contato.leads.length})</h2>
        {contato.leads.length === 0 ? (
          <EmptyState
            title="Nenhum lead"
            description="Esta pessoa ainda não virou oportunidade no funil."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Etapa</th>
                <th className="py-2 font-medium">Responsável</th>
                <th className="py-2 font-medium">Canal</th>
                <th className="py-2 font-medium">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {contato.leads.map((lead) => (
                <tr key={lead.id} className="border-b hover:bg-muted/40">
                  <td className="py-2">
                    <Link href={`/leads/${lead.id}`} className="text-primary underline">
                      {lead.etapaNome}
                    </Link>
                  </td>
                  <td className="py-2">{lead.responsavelNome}</td>
                  <td className="py-2 text-muted-foreground">{lead.canal}</td>
                  <td className="py-2 text-muted-foreground">{formatarDataHoraBR(lead.criadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mostrarConversas && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Conversas ({conversas.length})</h2>
          {conversas.length === 0 ? (
            <EmptyState
              title="Nenhuma conversa"
              description="Conversas de WhatsApp aparecem aqui quando o número desta pessoa escreve."
            />
          ) : (
            <ul className="space-y-1 text-sm">
              {conversas.map((conversa) => (
                <li key={conversa.id} className="flex items-center gap-3 border-b py-2">
                  <Link href={`/conversas/${conversa.id}`} className="text-primary underline">
                    {/* Mesma cadeia de fallback da inbox: a Evolution nem
                        sempre manda o nome do perfil, e o telefone só é
                        gravado quando o número é reconhecido como brasileiro. */}
                    {conversa.nomeExibicao ?? conversa.telefone ?? conversa.waId}
                  </Link>
                  <span className="text-muted-foreground">
                    {conversa.iaAtiva ? "IA respondendo" : "IA pausada"}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {formatarDataHoraBR(conversa.atualizadoEm)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
