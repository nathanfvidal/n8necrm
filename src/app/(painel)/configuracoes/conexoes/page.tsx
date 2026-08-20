import { redirect } from "next/navigation";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { listarConexoes } from "@/core/conexoes/service";
import { ConexaoForm } from "@/components/conexoes/conexao-form";
import { ConexoesTable } from "@/components/conexoes/conexoes-table";

/**
 * Conexões de WhatsApp da empresa — ADMIN apenas (`gerenciar_conexoes`).
 *
 * ## Uma LISTA, não um formulário único
 *
 * Multi-instância é decisão travada do programa (nº 4): uma empresa pode ter
 * mais de uma conexão, e a resposta sai pela conexão por onde a mensagem
 * entrou (`Conversation.connectionId`). Um formulário único esconderia a
 * segunda conexão e faria a segunda instância parecer impossível.
 *
 * ## NÃO há portão de módulo aqui, e isso é diferente de `/conversas/agente`
 *
 * Aquela tela é do módulo `whatsapp` e chama `exigirModulo` antes do gate de
 * permissão. Esta é de administração: uma empresa que ainda não tem o módulo
 * ligado precisa poder CADASTRAR a conexão antes — exigir o módulo aqui
 * criaria um ovo-e-galinha em que ninguém consegue configurar nada. O que
 * `modulos` decide é se as CONVERSAS aparecem, não se o ADMIN pode preparar o
 * canal.
 *
 * `(painel)/layout.tsx` já garante sessão válida; `usuarioAtualOuLogin()` aqui
 * lê o papel para o gate e o `companyId` para a listagem — que nunca vem de
 * parâmetro de rota nem de `searchParams`, pelo mesmo motivo das actions.
 */
export default async function ConexoesPage() {
  const usuario = await usuarioAtualOuLogin();

  if (!hasPermission(usuario.papel, "gerenciar_conexoes")) {
    redirect("/");
  }

  const conexoes = await listarConexoes(usuario.companyId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Conexões de WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          A chave de API fica guardada cifrada e não pode ser lida de volta — só substituída.
          Depois de cadastrar, cole a URL de webhook no painel da Evolution.
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h3 className="mb-3 text-sm font-medium">Adicionar conexão</h3>
        <ConexaoForm />
      </div>

      <ConexoesTable conexoes={conexoes} />
    </div>
  );
}
