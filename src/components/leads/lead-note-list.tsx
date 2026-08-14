"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmarDialogo } from "@/components/confirmar-dialogo";
import { EmptyState } from "@/components/empty-state";
import { editarNotaAction, excluirNotaAction } from "@/core/leads/actions";
import { formatarDataHoraBR } from "@/lib/date";

export type NotaLinha = {
  id: string;
  texto: string;
  criadoEm: Date;
  editadoEm: Date | null;
  autorId: string;
  autorNome: string;
};

/**
 * Histórico de notas com edição em linha, no padrão de `user-table.tsx`: um
 * estado guarda o id da linha em edição, e só ela troca de forma.
 *
 * Os botões só aparecem para o autor, mas isso é conveniência de interface,
 * NÃO proteção: `editarNota`/`excluirNota` (`core/leads/notes.ts`) conferem o
 * dono no servidor. Server Action é endpoint HTTP público — esconder botão
 * não protege endpoint.
 */
export function LeadNoteList({
  notas,
  leadId,
  idDoUsuarioAtual,
  textoMaxLength,
}: {
  notas: NotaLinha[];
  leadId: string;
  idDoUsuarioAtual: string;
  textoMaxLength: number;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function comecarEdicao(nota: NotaLinha) {
    setErro(null);
    setEditando(nota.id);
    setRascunho(nota.texto);
  }

  async function salvar(notaId: string) {
    setErro(null);
    setSalvando(true);
    const resultado = await editarNotaAction({ notaId, leadId, texto: rascunho });
    setSalvando(false);

    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setEditando(null);
    router.refresh();
  }

  async function excluir(notaId: string) {
    setErro(null);
    const resultado = await excluirNotaAction({ notaId, leadId });
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    router.refresh();
  }

  if (notas.length === 0) {
    return <EmptyState title="Sem notas" description="Nenhuma nota registrada para este lead." />;
  }

  return (
    <div className="space-y-2">
      {erro && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-600">
          {erro}
        </p>
      )}

      {notas.map((nota) => {
        const souAutor = nota.autorId === idDoUsuarioAtual;
        const emEdicao = editando === nota.id;

        return (
          <div key={nota.id} className="rounded border p-3 text-sm">
            {emEdicao ? (
              <div className="space-y-2">
                <textarea
                  aria-label={`Texto da nota de ${nota.autorNome}`}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  rows={3}
                  maxLength={textoMaxLength}
                  value={rascunho}
                  onChange={(evento) => setRascunho(evento.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => salvar(nota.id)} disabled={salvando}>
                    {salvando ? "Salvando..." : "Salvar"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditando(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* `whitespace-pre-wrap` preserva as quebras que a pessoa
                    digitou; `break-words` impede que uma string sem espaços
                    estoure a largura. React escapa o texto por padrão. */}
                <p className="whitespace-pre-wrap break-words">{nota.texto}</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    {nota.autorNome} · {formatarDataHoraBR(nota.criadoEm)}
                    {/* Sem esta marca o histórico mente por omissão: o texto
                        muda e nada indica que mudou. */}
                    {nota.editadoEm ? " · editada" : ""}
                  </p>
                  {souAutor && (
                    <>
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => comecarEdicao(nota)}
                      >
                        Editar
                      </button>
                      {/* Nota apagada não volta — o texto fica só na
                          auditoria. O gatilho se chama "Excluir nota" e a
                          confirmação "Excluir": rótulos distintos porque os
                          dois coexistem no DOM com o diálogo aberto, e um
                          localizador por nome precisa alcançar um sem
                          esbarrar no outro. Mesma regra do botão de
                          arquivar. */}
                      <ConfirmarDialogo
                        gatilho={(abrir) => (
                          <button
                            type="button"
                            className="text-xs text-red-600 underline"
                            onClick={abrir}
                          >
                            Excluir nota
                          </button>
                        )}
                        titulo="Excluir esta nota?"
                        descricao="Isso não pode ser desfeito. O texto fica registrado apenas na auditoria."
                        rotuloConfirmar="Excluir"
                        onConfirmar={() => excluir(nota.id)}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
