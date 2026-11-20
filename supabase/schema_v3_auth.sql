-- =============================================================================
-- AUTENTICAÇÃO — Supabase Auth + cada usuário É um cliente
-- Rode no SQL Editor do Supabase. Pode rodar mais de uma vez.
--
-- Como cadastrar um usuário novo:
--   1) Authentication > Users > Invite user (e-mail do cliente). Ele recebe o link e cria a senha.
--   2) Rode: INSERT INTO clientes (nome, email) VALUES ('Nome do cliente', 'email@dele.com');
--      O e-mail deve ser o MESMO do convite, em minúsculas.
--   Para bloquear: UPDATE clientes SET ativo = false WHERE email = '...';
-- =============================================================================

-- 1. O cliente passa a ter e-mail de acesso (um e-mail = um cliente)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_email_minusculo;
ALTER TABLE clientes ADD CONSTRAINT clientes_email_minusculo CHECK (email IS NULL OR email = lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS clientes_email_unico ON clientes (email) WHERE email IS NOT NULL;

-- 2. Nomes de cliente deixam de ser limitados aos dois originais
ALTER TABLE cupons_fila DROP CONSTRAINT IF EXISTS cupons_fila_cliente_check;
ALTER TABLE cupons_lancamentos DROP CONSTRAINT IF EXISTS cupons_lancamentos_cliente_check;

-- 3. SEGURANÇA: a chave anon fica pública no navegador. Nenhuma tabela pode ser lida por ela.
--    O acesso aos dados passa só pelo servidor (service_role), que checa o login e filtra por cliente.
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cupons_fila ENABLE ROW LEVEL SECURITY;
ALTER TABLE cupons_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE envios_lotes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON clientes, cupons_fila, cupons_lancamentos, categorias, envios_lotes FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência: deve listar as 5 tabelas com rowsecurity = true
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
