-- =============================================================================
-- SCHEMA_V5_ADMIN.SQL — Perfil de Administrador e Controle de Uso (Limite Mensal)
-- Pode ser executado mais de uma vez com segurança (idempotente).
-- =============================================================================

ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS eh_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS limite_mensal_envios INT;

-- Define o administrador principal
UPDATE clientes
SET eh_admin = TRUE
WHERE lower(email) = 'trab.andrecosta@gmail.com';

NOTIFY pgrst, 'reload schema';
