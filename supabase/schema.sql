-- =============================================================================
-- SCHEMA.SQL — Banco de dados Supabase para Leitura de Cupons Fiscais
-- Executa este script no SQL Editor do Supabase Dashboard.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensões necessárias
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 2. Bucket no Supabase Storage
--    Criar manualmente no Dashboard → Storage → New Bucket:
--      Nome: cupons
--      Público: NÃO (privado)
--    Estrutura interna de pastas gerenciada por código:
--      cupons/{cliente}/{ano-mes}/{uuid}.jpg
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. Tabela: cupons_fila
--    Registra cada imagem enviada e controla o ciclo de vida do processamento.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cupons_fila (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente                 TEXT NOT NULL CHECK (cliente IN ('Wal Salgados', 'André Buffet')),
    storage_path            TEXT NOT NULL,          -- caminho no bucket (ex.: "wal-salgados/2026-11/abc123.jpg")
    mime_type               TEXT NOT NULL DEFAULT 'image/jpeg',
    tamanho_original_bytes  BIGINT NOT NULL DEFAULT 0,
    tamanho_comprimido_bytes BIGINT NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'pendente'
                            CHECK (status IN ('pendente', 'processando', 'processado', 'revisao_manual')),
    tentativas              INT NOT NULL DEFAULT 0,
    proxima_tentativa_em    TIMESTAMPTZ,            -- NULL = pode processar agora
    ultimo_erro             TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice composto para busca eficiente da fila de processamento
CREATE INDEX IF NOT EXISTS idx_fila_processamento
    ON cupons_fila (status, proxima_tentativa_em, tentativas)
    WHERE status IN ('pendente', 'processando');

-- Índice para listagem por cliente/data
CREATE INDEX IF NOT EXISTS idx_fila_cliente_data
    ON cupons_fila (cliente, criado_em DESC);

-- ---------------------------------------------------------------------------
-- 4. Tabela: cupons_lancamentos
--    Dados estruturados extraídos pela Gemini API, prontos para Looker Studio.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cupons_lancamentos (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cupom_id            UUID NOT NULL REFERENCES cupons_fila(id) ON DELETE CASCADE,
    cliente             TEXT NOT NULL CHECK (cliente IN ('Wal Salgados', 'André Buffet')),
    data_emissao        DATE,
    estabelecimento     TEXT,
    cnpj                TEXT,
    valor_total         NUMERIC(12,2),
    forma_pagamento     TEXT,
    categoria           TEXT,
    resumo_itens        TEXT,                       -- resumo legível dos itens
    dados_brutos_json   JSONB,                      -- resposta completa da IA para auditoria
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para Looker Studio e consultas analíticas
CREATE INDEX IF NOT EXISTS idx_lancamentos_cliente
    ON cupons_lancamentos (cliente, data_emissao DESC);

CREATE INDEX IF NOT EXISTS idx_lancamentos_data
    ON cupons_lancamentos (data_emissao DESC);

CREATE INDEX IF NOT EXISTS idx_lancamentos_categoria
    ON cupons_lancamentos (categoria);

-- ---------------------------------------------------------------------------
-- 5. Trigger para atualizar "atualizado_em" automaticamente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cupons_fila_atualizado
    BEFORE UPDATE ON cupons_fila
    FOR EACH ROW
    EXECUTE FUNCTION atualizar_timestamp();

-- ---------------------------------------------------------------------------
-- 6. View para Looker Studio — consolida dados para dashboards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_dashboard_cupons AS
SELECT
    l.id                    AS lancamento_id,
    l.cliente,
    l.data_emissao,
    l.estabelecimento,
    l.cnpj,
    l.valor_total,
    l.forma_pagamento,
    l.categoria,
    l.resumo_itens,
    l.criado_em             AS processado_em,
    f.tamanho_original_bytes,
    f.tamanho_comprimido_bytes,
    f.storage_path,
    f.criado_em             AS enviado_em,
    -- Campos calculados úteis para o dashboard
    EXTRACT(YEAR FROM l.data_emissao)   AS ano,
    EXTRACT(MONTH FROM l.data_emissao)  AS mes,
    TO_CHAR(l.data_emissao, 'YYYY-MM')  AS ano_mes,
    ROUND(
        (1.0 - f.tamanho_comprimido_bytes::NUMERIC / NULLIF(f.tamanho_original_bytes, 0)) * 100,
        1
    ) AS percentual_compressao
FROM cupons_lancamentos l
JOIN cupons_fila f ON f.id = l.cupom_id
WHERE f.status = 'processado'
ORDER BY l.data_emissao DESC;

-- ---------------------------------------------------------------------------
-- 7. View de monitoramento da fila (útil para debug e dashboard operacional)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_fila_status AS
SELECT
    status,
    cliente,
    COUNT(*)                            AS total,
    MIN(criado_em)                      AS mais_antigo,
    MAX(criado_em)                      AS mais_recente,
    AVG(tentativas)                     AS media_tentativas
FROM cupons_fila
GROUP BY status, cliente
ORDER BY status, cliente;

-- ---------------------------------------------------------------------------
-- 8. Política RLS (Row Level Security) — protege acesso direto
--    Habilita RLS mas permite que o service_role_key ignore as políticas.
-- ---------------------------------------------------------------------------
ALTER TABLE cupons_fila ENABLE ROW LEVEL SECURITY;
ALTER TABLE cupons_lancamentos ENABLE ROW LEVEL SECURITY;

-- Política: apenas service_role pode inserir/atualizar/ler (via API serverless)
CREATE POLICY "service_role_full_access_fila" ON cupons_fila
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_lancamentos" ON cupons_lancamentos
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
