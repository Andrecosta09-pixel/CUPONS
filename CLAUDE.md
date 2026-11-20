# Regras do projeto — Cupom Fiscal PWA

Responda em português do Brasil, direto e curto. Leia `PASSAGEM.md` no começo de cada sessão.

## Nunca
- Subir `.env`, `CREDENCIAIS.txt` ou qualquer chave (service_role, Gemini, CRON_SECRET) para o Git.
- Colocar chave no código: use variáveis de ambiente (`config_local.py` no Python, `process.env` na Vercel).
- Devolver dados sem filtrar pelo cliente do usuário logado. Toda rota `/api/` valida o token.
- Criar conta, publicar ou mexer no banco de produção sem o André pedir.

## Design (ERIC 1.2 — detalhes em `docs/design_handoff_eric_design_system/`)
- Sem sombra e sem degradê em botões e cards; profundidade = borda 1px + troca de fundo.
- Cores só por token `var(--c-*)`, nunca hex solto. Fonte Poppins. Ícones Lucide (sprite em `public/icons.svg`), nunca emoji.
- Nada quebra linha em tabela, botão, selo ou aba (nowrap + ellipsis).
- Cor por status: verde = concluído, laranja = pendente, azul = ação/andamento, vermelho = erro, cinza = neutro; sempre com texto.
- Botão = verbo ("Confirmar", "Salvar senha e entrar"), nunca "OK/Sim/Não". "Solicitação", nunca "pedido".
- Tema claro é o padrão. WCAG 2.2 AA, foco visível, toque de 44 px no mobile, campo de 16 px no mobile.
- Gráficos: título = conclusão, eixo em 0, "Ver dados" com tabela, sem pizza.
- Avisos: use `toast()` e `confirmar()` de `public/avisos.js`, nunca `alert()`/`confirm()`.

## Qualidade
- Teste em 390 e 1280 px antes de dar como pronto. Teste que não consegue falhar não é teste.
- Datas dd/mm/aaaa, moeda R$ 1.250,00.
