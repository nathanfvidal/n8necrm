"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  atualizarUsuarioAction,
  definirAtivoAction,
  redefinirSenhaAction,
} from "@/core/users/actions";
import { PAPEIS, rotuloDoPapel } from "./papeis";
import type { UsuarioListado } from "@/core/users/queries";
import type { Role } from "@prisma/client";

/**
 * Tabela da equipe, com edição de nome e papel, ativação/desativação e
 * redefinição de senha.
 *
 * `<table>` simples em vez de TanStack Table (usada em `lead-table.tsx`) de
 * propósito: aqui não há filtro, ordenação nem paginação a resolver — uma
 * equipe de revenda tem unidades de pessoas, não centenas. Trazer a biblioteca
 * custaria o mesmo aviso de compilação do React Compiler que a outra tabela já
 * carrega, sem nada em troca.
 *
 * `idDoUsuarioAtual` chega por prop para desabilitar as ações que o servidor
 * vai recusar de qualquer forma (desativar a si mesmo, mudar o próprio papel).
 * A tela desabilitar é conveniência; a recusa de verdade está em
 * `core/users/service.ts`, e continuaria valendo para um POST direto.
 */
export function UserTable({
  usuarios,
  idDoUsuarioAtual,
}: {
  usuarios: UsuarioListado[];
  idDoUsuarioAtual: string;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [trocandoSenha, setTrocandoSenha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aguardandoAction, setAguardandoAction] = useState(false);
  const [atualizando, iniciarAtualizacao] = useTransition();

  /**
   * "Ocupado" tem duas metades, e a segunda faltava.
   *
   * `aguardandoAction` cobre a ida à Server Action. Só que o `finally` a
   * desliga assim que a action responde, e a TABELA só muda quando o render
   * do servidor chega — quase um segundo depois, porque cada consulta é uma
   * viagem até São Paulo. Nessa janela os botões voltavam a parecer livres em
   * cima de uma lista que ainda mostrava o papel antigo.
   *
   * `router.refresh()` devolve `void` e não dá para aguardar; dentro de
   * `startTransition`, `isPending` só cai quando o render chega. Somando as
   * duas, `ocupado` passa a significar "a tela ainda não é a verdade" — que é
   * o que os `disabled` abaixo sempre quiseram dizer.
   */
  const ocupado = aguardandoAction || atualizando;

  async function executar(acao: () => Promise<{ ok: true } | { ok: false; erro: string }>) {
    setErro(null);
    setAguardandoAction(true);
    try {
      const resultado = await acao();
      if (!resultado.ok) {
        setErro(resultado.erro);
        return false;
      }
      iniciarAtualizacao(() => router.refresh());
      return true;
    } finally {
      setAguardandoAction(false);
    }
  }

  return (
    <div className="space-y-3">
      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">Nome</th>
            <th className="py-2 font-medium">E-mail</th>
            <th className="py-2 font-medium">Papel</th>
            <th className="py-2 font-medium">Situação</th>
            <th className="py-2 font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((usuario) => {
            const ehVoce = usuario.id === idDoUsuarioAtual;

            if (editando === usuario.id) {
              return (
                <LinhaEmEdicao
                  key={usuario.id}
                  usuario={usuario}
                  ehVoce={ehVoce}
                  ocupado={ocupado}
                  onCancelar={() => setEditando(null)}
                  onSalvar={async (nome, papel) => {
                    const ok = await executar(() =>
                      atualizarUsuarioAction({ id: usuario.id, nome, papel })
                    );
                    if (ok) setEditando(null);
                  }}
                />
              );
            }

            return (
              <tr key={usuario.id} className="border-b">
                <td className="py-2">{usuario.nome}</td>
                <td className="py-2 text-muted-foreground">{usuario.email}</td>
                <td className="py-2">{rotuloDoPapel(usuario.papel)}</td>
                <td className="py-2">
                  <span className={usuario.ativo ? "text-green-700" : "text-muted-foreground"}>
                    {usuario.ativo ? "Ativo" : "Desativado"}
                  </span>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={ocupado}
                      onClick={() => {
                        setErro(null);
                        setTrocandoSenha(null);
                        setEditando(usuario.id);
                      }}
                    >
                      Editar
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={ocupado || (ehVoce && usuario.ativo)}
                      title={
                        ehVoce && usuario.ativo ? "Você não pode desativar a própria conta" : undefined
                      }
                      onClick={() =>
                        executar(() => definirAtivoAction({ id: usuario.id, ativo: !usuario.ativo }))
                      }
                    >
                      {usuario.ativo ? "Desativar" : "Reativar"}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={ocupado}
                      onClick={() => {
                        setErro(null);
                        setEditando(null);
                        setTrocandoSenha(trocandoSenha === usuario.id ? null : usuario.id);
                      }}
                    >
                      Nova senha
                    </Button>
                  </div>

                  {trocandoSenha === usuario.id && (
                    <FormularioDeSenha
                      nome={usuario.nome}
                      ocupado={ocupado}
                      onCancelar={() => setTrocandoSenha(null)}
                      onSalvar={async (senha) => {
                        const ok = await executar(() =>
                          redefinirSenhaAction({ id: usuario.id, senha })
                        );
                        if (ok) setTrocandoSenha(null);
                      }}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LinhaEmEdicao({
  usuario,
  ehVoce,
  ocupado,
  onSalvar,
  onCancelar,
}: {
  usuario: UsuarioListado;
  ehVoce: boolean;
  ocupado: boolean;
  onSalvar: (nome: string, papel: Role) => void;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState(usuario.nome);
  const [papel, setPapel] = useState<Role>(usuario.papel);

  return (
    <tr className="border-b bg-muted/40">
      <td className="py-2">
        <Input
          aria-label={`Nome de ${usuario.nome}`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      </td>
      <td className="py-2 text-muted-foreground">{usuario.email}</td>
      <td className="py-2">
        <select
          aria-label={`Papel de ${usuario.nome}`}
          value={papel}
          onChange={(e) => setPapel(e.target.value as Role)}
          // Mudar o próprio papel é recusado pelo servidor — quem se rebaixa
          // perde, na mesma ação, o acesso a esta tela.
          disabled={ehVoce}
          className="h-9 rounded-md border bg-background px-3 text-sm disabled:opacity-50"
        >
          {PAPEIS.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2">{usuario.ativo ? "Ativo" : "Desativado"}</td>
      <td className="py-2">
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={ocupado} onClick={() => onSalvar(nome, papel)}>
            Salvar
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={onCancelar}>
            Cancelar
          </Button>
        </div>
      </td>
    </tr>
  );
}

function FormularioDeSenha({
  nome,
  ocupado,
  onSalvar,
  onCancelar,
}: {
  nome: string;
  ocupado: boolean;
  onSalvar: (senha: string) => void;
  onCancelar: () => void;
}) {
  const [senha, setSenha] = useState("");

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Nova senha de ${nome}`}
        type="password"
        autoComplete="new-password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        className="w-56"
      />
      <Button type="button" size="sm" disabled={ocupado} onClick={() => onSalvar(senha)}>
        Salvar senha
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={onCancelar}>
        Cancelar
      </Button>
      <span className="text-xs text-muted-foreground">
        Entregue a senha à pessoa por fora — o sistema não envia e-mail.
      </span>
    </div>
  );
}
