-- =============================================================================
-- SCHEMA_V4_BUFFET.SQL — Normalização de Estabelecimentos (CNPJ/Filiais)
-- e Categorias Oficiais focadas em empresas de Buffet.
-- Pode ser executado mais de uma vez com segurança (idempotente).
-- =============================================================================

-- 1. Tabela de regras de normalização de estabelecimentos por cliente
-- Permite agrupar filiais do mesmo grupo/rede (via CNPJ, raiz de 8 dígitos ou
-- padrão de nome) sob um único Nome Canônico exibido no dashboard.
CREATE TABLE IF NOT EXISTS estabelecimentos_regras (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente         TEXT NOT NULL,
    cnpj            TEXT,               -- 14 dígitos (match exato de filial)
    cnpj_raiz       TEXT,               -- 8 primeiros dígitos (agrupa todas as filiais da rede)
    padrao_nome     TEXT,               -- nome normalizado (fallback quando sem CNPJ)
    nome_canonico   TEXT NOT NULL,      -- nome limpo exibido no dashboard
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estab_regras_cliente
    ON estabelecimentos_regras (cliente);

CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_regras_cliente_cnpj_raiz
    ON estabelecimentos_regras (cliente, cnpj_raiz)
    WHERE cnpj_raiz IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_regras_cliente_padrao
    ON estabelecimentos_regras (cliente, padrao_nome)
    WHERE cnpj_raiz IS NULL AND padrao_nome IS NOT NULL;

-- Segurança RLS (mesmo padrão de schema_v3_auth.sql: anon/authenticated sem acesso direto)
ALTER TABLE estabelecimentos_regras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON estabelecimentos_regras FROM anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'estabelecimentos_regras'
          AND policyname = 'service_role_full_access_estab_regras'
    ) THEN
        CREATE POLICY "service_role_full_access_estab_regras" ON estabelecimentos_regras
            FOR ALL
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

-- 2. Atualizar tabela de categorias para as 7 categorias oficiais de Buffet
DELETE FROM categorias;
INSERT INTO categorias (nome, icone)
VALUES
    ('Proteínas & Frios', 'utensils'),
    ('Mercearia & Secos', 'package'),
    ('Hortifruti & Padaria', 'leaf'),
    ('Embalagens & Descartáveis', 'box'),
    ('Limpeza & Utensílios', 'sparkles'),
    ('Combustível & Logística', 'truck'),
    ('Outros', 'tag')
ON CONFLICT (nome) DO NOTHING;

NOTIFY pgrst, 'reload schema';
