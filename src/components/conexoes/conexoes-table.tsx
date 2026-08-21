"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ConexaoApresentada } from "@/core/conexoes/service";
import {
  substituirSegredoAction,
  definirAtivaAction,
  regenerarWebhookAction,
  apagarConexaoAction,
} from "@/core/conexoes/actions";
import { registrarFalhaDeRede } from "@/lib/acao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmarDialogo } from "@/components/confirmar-dialogo";

/**
 * A URL do webhook, mostrada UMA vez.
 *
 * ## Por que isto não contradiz "o segredo nunca volta para o navegador"
 *
 * A regra é sobre DECIFRAR: nada que esteja guardado no cofre volta. Este
 * token não veio do cofre — o servidor acabou de sorteá-lo e guardou só o
 * `sha256` dele (`core/conexoes/webhook-token.ts`). Sem esta entrega única não
 * haveria como a pessoa colar a URL no painel da Evolution, e a alternativa
 * (guardar o token legível para exibir depois) seria trocar uma entrega
 * controlada por um segredo permanentemente legível.
 *
 * ## `window.location.origin` e não uma variável de ambiente
 *
 * Quem sabe a origem com certeza é o navegador. Montá-la no servidor exigiria
 * uma variável nova ou confiar no header `Host`, que é do cliente — e a
 * action, de propósito, devolve só o PATH.
 */
export function AvisoDeWebhook({ caminho }: { caminho: string }) {
  const origem = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium">Cole esta URL no webhook da instância, no painel da Evolution:</p>
      <code
        className="mt-2 block overflow-x-auto rounded bg-background p-2 text-xs"
        data-testid="url-webhook"
      >
        {origem}
        {caminho}
      </code>
      <p className="mt-2 text-xs text-muted-foreground">
        Ela não aparece de novo. Se perder, gere outra pelo botão &ldquo;Nova URL&rdquo; — a antiga
        deixa de funcionar na hora.
      </p>
    </div>
  );
}

export function ConexoesTable({ conexoes }: { conexoes: ConexaoApresentada[] }) {
  const router = useRouter();
  const [trocandoChave, setTrocandoChave] = useState<string | null>(null);
  const [chaveNova, setChaveNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [webhookPath, setWebhookPath] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();

  async function executar(rotulo: string, acao: () => Promise<{ ok: boolean; erro?: string }>) {
    setErro(null);
    try {
      const resultado = await acao();
      if (!resultado.ok) {
        setErro(resultado.erro ?? rotulo);
        return false;
      }
      router.refresh();
      return true;
    } catch (erroDeRede) {
      // Mesma metade de cliente do contrato de `ResultadoAcao` que
      // `conexao-form.tsx` documenta: a action promete não lançar, o
      // TRANSPORTE não promete nada.
      setErro(registrarFalhaDeRede(rotulo, erroDeRede));
      return false;
    }
  }

  if (conexoes.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nenhuma conexão cadastrada. Sem uma conexão ativa, esta empresa não recebe nem envia
        mensagem de WhatsApp — não existe credencial padrão de ambiente.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
      {webhookPath ? <AvisoDeWebhook caminho={webhookPath} /> : null}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">Nome</th>
            <th className="py-2 font-medium">Instância</th>
            <th className="py-2 font-medium">Chave</th>
            <th className="py-2 font-medium">Última troca</th>
            <th className="py-2 font-medium">Estado</th>
            <th className="py-2 font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {conexoes.map((conexao) => (
            <tr
              key={conexao.id}
              className="border-b align-top"
              data-testid={`conexao-${conexao.id}`}
            >
              <td className="py-2">
                {conexao.nome}
                <div className="text-xs text-muted-foreground">{conexao.dominio}</div>
              </td>
              <td className="py-2">{conexao.instancia}</td>
              <td className="py-2">
                {/* A máscara chega PRONTA do servidor. O cliente nunca recebeu
                    o valor real para poder derivá-la — o e2e
                    `configuracoes-conexoes.spec.ts` prova isso do jeito que só
                    um navegador prova: o HTML servido não contém a apikey. */}
                <code data-testid={`mascara-${conexao.id}`}>{conexao.mascara}</code>
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                {conexao.segredoAtualizadoEm.toLocaleDateString("pt-BR")}
                {conexao.segredoAtualizadoPor ? ` · ${conexao.segredoAtualizadoPor}` : ""}
              </td>
              <td className="py-2">{conexao.ativa ? "Ativa" : "Inativa"}</td>
              <td className="space-x-2 py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={processando}
                  onClick={() => {
                    setChaveNova("");
                    setTrocandoChave(trocandoChave === conexao.id ? null : conexao.id);
                  }}
                >
                  Substituir chave
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={processando}
                  onClick={() =>
                    iniciar(async () => {
                      await executar("Falha ao mudar o estado da conexão", () =>
                        definirAtivaAction({ id: conexao.id, ativa: !conexao.ativa })
                      );
                    })
                  }
                >
                  {conexao.ativa ? "Desativar" : "Ativar"}
                </Button>

                {/* Confirmação em DOM (`ConfirmarDialogo`), nunca
                    `window.confirm`: o diálogo nativo bloqueia a thread e é
                    invisível ao DOM, então só existe num teste através de um
                    canal lateral que, se ninguém armar, faz o Playwright
                    descartá-lo sozinho — o clique "funciona", nada acontece, e
                    a falha aparece numa asserção adiante sem dizer por quê.
                    O raciocínio inteiro está em `components/confirmar-dialogo.tsx`. */}
                <ConfirmarDialogo
                  gatilho={(abrir) => (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={abrir}
                      disabled={processando}
                    >
                      Nova URL
                    </Button>
                  )}
                  titulo="Gerar uma URL de webhook nova?"
                  descricao={
                    "A URL atual para de funcionar na hora, e as mensagens deixam de chegar até " +
                    "você colar a nova no painel da Evolution. A conexão continua marcada como " +
                    "Ativa — o CRM não tem como saber que o painel ainda aponta para a antiga."
                  }
                  rotuloConfirmar="Gerar nova URL"
                  rotuloConfirmando="Gerando..."
                  onConfirmar={async () => {
                    setErro(null);
                    try {
                      const resultado = await regenerarWebhookAction({ id: conexao.id });
                      if (!resultado.ok) {
                        setErro(resultado.erro);
                        return;
                      }
                      setWebhookPath(resultado.webhookPath);
                      router.refresh();
                    } catch (erroDeRede) {
                      setErro(registrarFalhaDeRede("Falha ao gerar URL nova", erroDeRede));
                    }
                  }}
                />

                <ConfirmarDialogo
                  gatilho={(abrir) => (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={abrir}
                      disabled={processando}
                    >
                      Apagar
                    </Button>
                  )}
                  titulo={`Apagar a conexão "${conexao.nome}"?`}
                  descricao={
                    "As conversas ficam no histórico, mas deixam de saber por onde entraram — e " +
                    "voltam a ser respondidas pela única conexão ativa da empresa, ou por " +
                    "nenhuma, se houver mais de uma. A chave de API é apagada junto e não tem " +
                    "como ser recuperada."
                  }
                  rotuloConfirmar="Apagar conexão"
                  rotuloConfirmando="Apagando..."
                  exigirDigitar={conexao.nome}
                  onConfirmar={async () => {
                    await executar("Falha ao apagar a conexão", () =>
                      apagarConexaoAction({ id: conexao.id })
                    );
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {trocandoChave ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border p-3"
          onSubmit={(evento) => {
            evento.preventDefault();
            const id = trocandoChave;
            iniciar(async () => {
              const ok = await executar("Falha ao substituir a chave", () =>
                substituirSegredoAction({ id, segredo: chaveNova })
              );
              if (ok) {
                // Limpo assim que a action confirma: manter o valor no estado
                // deixaria o segredo na memória do navegador sem razão.
                setChaveNova("");
                setTrocandoChave(null);
              }
            });
          }}
        >
          <div className="flex-1 space-y-1">
            <label className="text-sm" htmlFor="chave-nova">
              Chave nova
            </label>
            <Input
              id="chave-nova"
              type="password"
              autoComplete="off"
              value={chaveNova}
              onChange={(e) => setChaveNova(e.target.value)}
              placeholder="cole a apikey nova"
              required
            />
          </div>
          <Button type="submit" disabled={processando}>
            {processando ? "Substituindo..." : "Substituir"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setTrocandoChave(null)}>
            Cancelar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
