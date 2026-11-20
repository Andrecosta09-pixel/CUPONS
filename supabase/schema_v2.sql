-- =============================================================================
-- ATUALIZAÇÃO DO SCHEMA — Backlog North Stack
-- Tabelas de Clientes Reais, Categorias, Lote de Envios e Entradas Estruturadas
-- =============================================================================

-- 1. Tabela de Clientes Reais (sem mocks)
CREATE TABLE IF NOT EXISTS clientes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome        TEXT NOT NULL UNIQUE,
    documento   TEXT, -- CPF ou CNPJ opcional
    ativo       BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inserir os clientes existentes iniciais caso a tabela esteja vazia
INSERT INTO clientes (nome)
VALUES ('Wal Salgados'), ('André Buffet')
ON CONFLICT (nome) DO NOTHING;

-- 2. Tabela de Categorias Oficiais
CREATE TABLE IF NOT EXISTS categorias (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome        TEXT NOT NULL UNIQUE,
    icone       TEXT NOT NULL DEFAULT '🏷️',
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categorias (nome, icone)
VALUES 
    ('Mercado', '🛒'),
    ('Obra / construção', '🔨'),
    ('Combustível', '⛽'),
    ('Alimentação', '🍽️'),
    ('Farmácia / saúde', '💊'),
    ('Casa / utilidades', '🏠'),
    ('Serviços', '🛠️'),
    ('Outros', '📦')
ON CONFLICT (nome) DO NOTHING;

-- 3. Tabela de Lotes de Envios (Item 4 do Backlog)
CREATE TABLE IF NOT EXISTS envios_lotes (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id              UUID REFERENCES clientes(id) ON DELETE SET NULL,
    cliente_nome            TEXT NOT NULL,
    quantidade_imagens      INT NOT NULL DEFAULT 1,
    tamanho_total_bytes     BIGINT NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'processando'
                            CHECK (status IN ('compactando', 'enviando', 'processando', 'concluido', 'erro', 'cancelado')),
    responsavel             TEXT DEFAULT 'Operador Campo',
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Adicionar novas colunas na tabela cupons_fila e cupons_lancamentos
ALTER TABLE cupons_fila 
    ADD COLUMN IF NOT EXISTS lote_id UUID REFERENCES envios_lotes(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;

ALTER TABLE cupons_lancamentos
    ADD COLUMN IF NOT EXISTS lote_id UUID REFERENCES envios_lotes(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS confianca TEXT NOT NULL DEFAULT 'alta' CHECK (confianca IN ('alta', 'media', 'baixa')),
    ADD COLUMN IF NOT EXISTS status_revisao TEXT NOT NULL DEFAULT 'novo' CHECK (status_revisao IN ('novo', 'revisar', 'confirmado')),
    ADD COLUMN IF NOT EXISTS revisado_em TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS itens_json JSONB;

-- 5. Liberar permissões completas
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
