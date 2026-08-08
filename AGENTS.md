<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Nenhuma branch é integrada sem auditoria de segurança

Antes de fazer merge ou abrir PR de qualquer branch, rode a **Fase 1** da skill
`auditoria-seguranca` sobre a superfície que a branch mexeu, entregue o relatório e
**pare**. Correção só começa depois que o dono do projeto aprova o relatório.

Isto não é zelo excessivo, é resposta a um caso concreto: a branch que trouxe a gestão de
equipe deixou passar um logout que podia ser desfeito por um prefetch de `<Link>` — o
Auth.js reemitia o cookie de sessão e "Sair" deixava de revogar. O defeito foi achado por
um teste e2e falhando de forma intermitente, quase descartado como teste instável. Aquele
padrão exato já estava catalogado na tabela de armadilhas da skill (*"Sessão que
sobrevive"*), e ninguém a consultou.

Aplicar as restrições de segurança durante a construção é necessário e **não substitui** a
varredura: uma olha para o que você decidiu fazer, a outra para o que o sistema faz.

A regra que sustenta a skill: **provar, não presumir.** Todo item marcado `✅ OK` carrega o
comando executado e a saída obtida. O que este ambiente não permite provar sai como
`🔍 NÃO VERIFICADO`, com o comando que um humano precisa rodar — nunca como "ok" presumido.
