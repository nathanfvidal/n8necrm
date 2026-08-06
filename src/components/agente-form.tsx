"use client";

import { useState, useTransition } from "react";
import type { BotConfig } from "@prisma/client";

import { salvarConfigAgenteAction, restaurarConfigPadraoAction } from "@/modules/whatsapp/agente-actions";
import { montarPromptSistema } from "@/modules/whatsapp/prompt";
import { Button } from "@/components/ui/button";

/**
 * Editor da configuração do agente.
 *
 * As regras vivem num único `textarea`, uma por linha, em vez de uma lista de
 * campos com botões de adicionar/remover: são poucas, mudam raramente, e
 * editar texto corrido é mais rápido que operar uma lista — sem contar que a
 * lista precisaria de reordenação para ser útil, o que ninguém pediu.
 */
export function AgenteForm({ config }: { config: BotConfig }) {
  const [ativo, setAtivo] = useState(config.ativo);
  const [personaNome, setPersonaNome] = useState(config.personaNome);
  const [personaPapel, setPersonaPapel] = useState(config.personaPapel);
  const [regrasTexto, setRegrasTexto] = useState(config.regras.join("\n"));
  const [faq, setFaq] = useState(config.faq);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [processando, iniciar] = useTransition();

  const regras = regrasTexto
    .split("\n")
    .map((regra) => regra.trim())
    .filter((regra) => regra.length > 0);

  // Prévia calculada no cliente com a MESMA função que o servidor usa. Editar
  // algo cujo efeito é invisível é como programar sem compilar — e como
  // `montarPromptSistema` é pura e determinística, renderizar o texto final
  // custa quase nada e transforma "acho que ficou bom" em "é isto que o
  // modelo vai ler".
  const previa = montarPromptSistema({ personaNome, personaPapel, regras, faq });

  // As actions DEVOLVEM resultado, não lançam — `try/catch` aqui não
  // funcionaria em produção, porque o Next redige erros não tratados de
  // Server Action antes que cheguem ao cliente. Mesmo padrão de
  // `ConversaResponder`/`ConversaEstadoIa`: checa `resultado.ok`, nunca
  // `catch`. Ver o comentário de `ResultadoAcao` em
  // `src/modules/whatsapp/actions.ts`.
  function salvar() {
    setErro(null);
    setSalvo(false);
    iniciar(async () => {
      const resultado = await salvarConfigAgenteAction({ ativo, personaNome, personaPapel, regras, faq });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setSalvo(true);
    });
  }

  function restaurar() {
    // Confirmação porque a ação descarta trabalho e não tem desfazer.
    if (
      !window.confirm(
        "Restaurar persona, regras e FAQ ao padrão do fork? As edições atuais serão perdidas."
      )
    ) {
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await restaurarConfigPadraoAction();
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      // Reload cheio, não `router.refresh()`: os campos deste formulário são
      // `useState` inicializado a partir de `config` só no mount — trocar a
      // prop do Server Component pai não remonta este Client Component, e um
      // `router.refresh()` deixaria a tela mostrando os valores antigos
      // editados mesmo com a linha já restaurada no banco.
      window.location.reload();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <label className="flex items-center gap-2 rounded-md border p-3">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="text-sm font-medium">Atendimento automático ligado</span>
          <span className="text-xs text-muted-foreground">
            Desligado, a IA não responde em nenhuma conversa.
          </span>
        </label>

        <div className="space-y-1">
          <label htmlFor="persona-nome" className="text-sm font-medium">
            Nome da persona
          </label>
          <input
            id="persona-nome"
            className="w-full rounded-md border p-2 text-sm"
            value={personaNome}
            onChange={(e) => setPersonaNome(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="persona-papel" className="text-sm font-medium">
            Papel da persona
          </label>
          <input
            id="persona-papel"
            className="w-full rounded-md border p-2 text-sm"
            value={personaPapel}
            onChange={(e) => setPersonaPapel(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="regras" className="text-sm font-medium">
            Regras — uma por linha
          </label>
          <textarea
            id="regras"
            className="w-full rounded-md border p-2 font-mono text-xs"
            rows={12}
            value={regrasTexto}
            onChange={(e) => setRegrasTexto(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="faq" className="text-sm font-medium">
            Perguntas frequentes
          </label>
          <textarea
            id="faq"
            className="w-full rounded-md border p-2 text-xs"
            rows={8}
            value={faq}
            onChange={(e) => setFaq(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Deixe em branco para o agente não receber bloco de FAQ nenhum.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={salvar} disabled={processando}>
            {processando ? "Salvando…" : "Salvar"}
          </Button>
          <Button variant="outline" onClick={restaurar} disabled={processando}>
            Voltar ao padrão do fork
          </Button>
        </div>

        {salvo && <p className="text-sm text-muted-foreground">Salvo. Vale na próxima resposta.</p>}
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </div>

      <div className="space-y-1">
        <h2 className="text-sm font-medium">Prévia do prompt</h2>
        <p className="text-xs text-muted-foreground">É exatamente este texto que o modelo recebe.</p>
        <pre
          data-testid="previa-prompt"
          className="max-h-[40rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs"
        >
          {previa}
        </pre>
      </div>
    </div>
  );
}
