# Passagem do projeto — Cupom Fiscal PWA

Estado em 20/11/2026. Quem continua: André Costa.

## O que é
PWA onde cada **usuário é um cliente**: ele fotografa cupons fiscais, a IA (Gemini) lê os dados,
ele confere e confirma, e acompanha tudo num dashboard. Cada usuário só vê os próprios dados.

## O que está pronto
- **Login** com Supabase Auth: o administrador convida o e-mail, o usuário cria a senha no primeiro acesso.
  Também tem "esqueci minha senha" e "sair".
- **Isolamento por cliente**: o servidor valida o token em toda rota `/api/` e filtra pelo cliente do usuário
  (`clientes.email` = e-mail do login). A chave anon não lê nenhuma tabela (RLS).
- **Leitura por IA** (`api/processar-fila.js`): lista de modelos Gemini com fallback, foto com vários cupons
  gera um lançamento por cupom, datas DD/MM/AAAA.
- **Telas**: Novo Envio, Processamento (lista + painel lateral de detalhes), Novas Entradas,
  Histórico, Dashboard (filtros, KPIs com comparação, gráfico, categorias, pagamento, top estabelecimentos).
- **Design**: ERIC Design System 1.2 (tema claro, Poppins, ícones Lucide, sem sombra/degradê/emoji).
  Material completo em `docs/design_handoff_eric_design_system/`.
- Avisos próprios (`public/avisos.js`): toast e diálogo de confirmação no lugar de `alert()`/`confirm()`.

## O que falta (em ordem)
1. **Portar as rotas para a Vercel.** Hoje só o `dev_server.py` (Python, roda local) tem estas rotas:
   `/api/config`, `/api/eu`, `/api/novas-entradas`, `/api/processamento-fila`, `/api/imagem-cupom`,
   `/api/confirmar-entrada`, `/api/confirmar-todas`, `/api/categorias`.
   Na Vercel existem só `upload-cupom`, `reprocessar-cupom` e `processar-fila`.
   **Sem isso o site publicado não passa da tela de login.** Use `api/_auth.js` (já valida token e acha o cliente)
   e copie a lógica de filtro por cliente do `dev_server.py`.
2. **Trocar as chaves** (`service_role` do Supabase e a do Gemini): passaram por conversas durante o desenvolvimento.
3. **Ligar os dados antigos a um usuário**: os lançamentos de "Wal Salgados" e "André Buffet" não têm e-mail.
   Convide o e-mail e rode `UPDATE clientes SET email = '...' WHERE nome = '...';`.
4. Configurar na Vercel as variáveis (abaixo) e, no Supabase, **Site URL** e **Redirect URLs** com a URL publicada.

## Como rodar local
1. Copie `.env.example` para `.env` e preencha (peça os valores a quem administra; **nunca** suba o `.env`).
2. `python dev_server.py` e abra http://localhost:3000

## Banco (Supabase) — rodar nesta ordem no SQL Editor
`supabase/schema.sql`, `supabase/schema_v2.sql`, `supabase/schema_v3_auth.sql`.
Bucket de Storage `cupons` deve ser **privado**.

## Cadastrar um usuário
1. Authentication > Users > **Invite user** (e-mail do cliente).
2. `INSERT INTO clientes (nome, email) VALUES ('Nome', 'email@dele.com');` (e-mail em minúsculas).
3. Bloquear: `UPDATE clientes SET ativo = false WHERE email = '...';`

## Variáveis de ambiente (Vercel e `.env`)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`.

## Arquivos que NÃO estão no GitHub (de propósito)
`.env` e `CREDENCIAIS.txt` guardam as chaves reais. Passe-os ao André por canal privado, nunca pelo repositório.

## Mapa do código
- `public/` — front (index.html, app.js, auth.js, dashboard.js, avisos.js, styles.css, sw.js, icons.svg)
- `api/` — funções da Vercel (`_auth.js` é o módulo de login compartilhado)
- `dev_server.py` — backend local completo (usa `config_local.py` para ler o `.env`)
- `supabase/` — SQLs
- `processador.py`, `reprocessar.py`, `salvar_cupons.py` — scripts de apoio antigos
