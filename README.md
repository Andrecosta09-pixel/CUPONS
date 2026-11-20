# Cupom Fiscal PWA

PWA para fotografar cupons fiscais e ler os dados com IA (Gemini). Front em `public/`,
API serverless em `api/` (Vercel), banco e arquivos no Supabase (`supabase/*.sql`).

## Configuração
1. Copie `.env.example` para `.env` e preencha (o `.env` não vai para o GitHub).
2. Na Vercel, cadastre as mesmas variáveis (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`).
3. Rode os SQL de `supabase/` no projeto Supabase.

## Rodar local
`python dev_server.py` e abra http://localhost:3000

## Como a leitura funciona
`api/processar-fila.js` roda por cron (a cada 3 min), pega envios pendentes e lê a imagem com o Gemini,
tentando uma lista de modelos em ordem. Fotos com vários cupons geram um lançamento por cupom.
Design: ERIC Design System 1.2 (tema claro, Poppins, ícones Lucide).
