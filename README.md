# Cupom Fiscal PWA

PWA para fotografar cupons fiscais e ler os dados com IA (Gemini). Front em `public/`,
API serverless em `api/` (Vercel), banco e arquivos no Supabase (`supabase/*.sql`).

## Configuração
1. Copie `.env.example` para `.env` e preencha (o `.env` não vai para o GitHub).
2. Na Vercel, cadastre as mesmas variáveis (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`).
3. Rode no SQL Editor do Supabase, nesta ordem: `schema.sql`, `schema_v2.sql`, `schema_v3_auth.sql`.
4. Supabase > Authentication > URL Configuration: coloque a URL do site em *Site URL* e em *Redirect URLs* (e `http://localhost:3000/` para testar local).

## Usuários (cada usuário é um cliente)
1. Supabase > Authentication > Users > **Invite user** com o e-mail do cliente. Ele recebe o link e cria a própria senha.
2. No SQL Editor: `INSERT INTO clientes (nome, email) VALUES ('Nome do cliente', 'email@dele.com');` (e-mail em minúsculas, igual ao do convite).
3. Para bloquear: `UPDATE clientes SET ativo = false WHERE email = 'email@dele.com';`

Cada usuário só vê e envia os dados do próprio cliente. O servidor valida o login em toda rota `/api/`.

## Rodar local
`python dev_server.py` e abra http://localhost:3000

## Como a leitura funciona
`api/processar-fila.js` roda por cron (a cada 3 min), pega envios pendentes e lê a imagem com o Gemini,
tentando uma lista de modelos em ordem. Fotos com vários cupons geram um lançamento por cupom.
Design: ERIC Design System 1.2 (tema claro, Poppins, ícones Lucide).
