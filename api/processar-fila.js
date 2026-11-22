// =============================================================================
// API/PROCESSAR-FILA.JS — Worker de processamento assíncrono via Gemini API
// Executado por cron da Vercel (a cada 3 minutos). Busca cupons pendentes,
// envia para a Gemini API extrair dados e salva em cupons_lancamentos.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

export const config = { maxDuration: 60 };

/**
 * Configuração do worker de processamento.
 */
const WORKER_CONFIG = {
  TAMANHO_LOTE: 5,                    // Cupons processados por execução do cron
  MAX_TENTATIVAS: 5,                  // Máximo de tentativas antes de revisão manual
  // Modelos em ordem de tentativa (testados com cupom real em 20/11/2026; o 3.8-flash estava com timeout/503)
  GEMINI_MODELS: ['gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
  GEMINI_TIMEOUT_MS: 25000,           // Timeout por modelo (cai para o próximo se estourar)
  BACKOFF_BASE_MS: 2000,              // Base do backoff exponencial (2s)
  BACKOFF_MAX_MS: 300000              // Máximo de 5 minutos entre tentativas da fila
};

/**
 * Cria cliente Supabase com service_role_key.
 */
function criarClienteSupabase() {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chave) {
    throw new Error('Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  }

  return createClient(url, chave, {
    auth: { persistSession: false }
  });
}

/**
 * Handler principal — acionado pelo cron da Vercel.
 * GET /api/processar-fila (protegido por CRON_SECRET)
 */
export default async function handler(req, res) {
  // Aceitar GET (cron da Vercel) e POST (chamadas manuais)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  // Verificar se é chamada do cron (CRON_SECRET ou x-vercel-cron) ou do usuário logado
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  const ehCron = Boolean(req.headers['x-vercel-cron']) || (Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`);

  const supabase = criarClienteSupabase();
  let clienteFiltro = null;

  if (!ehCron) {
    const cliente = await autenticar(req, res, supabase);
    if (!cliente) return;
    clienteFiltro = cliente.nome;
  }

  const resultados = { processados: 0, falhas: 0, revisaoManual: 0, erros: [] };

  try {
    // --- 1. Buscar lote de cupons pendentes ---
    let consulta = supabase
      .from('cupons_fila')
      .select('*')
      .eq('status', 'pendente')
      .lt('tentativas', WORKER_CONFIG.MAX_TENTATIVAS)
      .or('proxima_tentativa_em.is.null,proxima_tentativa_em.lte.' + new Date().toISOString())
      .order('criado_em', { ascending: true })
      .limit(WORKER_CONFIG.TAMANHO_LOTE);

    if (clienteFiltro) {
      consulta = consulta.eq('cliente', clienteFiltro);
    }

    const { data: lote, error: erroLote } = await consulta;

    if (erroLote) {
      console.error('[WORKER] Erro ao buscar fila:', erroLote);
      return res.status(500).json({ erro: 'Falha ao consultar fila: ' + erroLote.message });
    }

    if (!lote || lote.length === 0) {
      return res.status(200).json({ mensagem: 'Fila vazia. Nada para processar.', ...resultados });
    }

    console.log(`[WORKER] Processando lote de ${lote.length} cupom(ns)...`);

    // --- 2. Processar cada cupom do lote ---
    for (const cupom of lote) {
      try {
        await processarCupom(supabase, cupom);
        resultados.processados++;
      } catch (erro) {
        resultados.falhas++;
        resultados.erros.push({ id: cupom.id, erro: erro.message });
        console.error(`[WORKER] Erro no cupom ${cupom.id}:`, erro.message);
      }
    }

    console.log(`[WORKER] Lote finalizado:`, resultados);
    return res.status(200).json({ mensagem: 'Lote processado.', ...resultados });

  } catch (erro) {
    console.error('[WORKER] Erro geral:', erro);
    return res.status(500).json({ erro: 'Erro interno: ' + erro.message });
  }
}

// ---------------------------------------------------------------------------
// Processamento individual de cada cupom
// ---------------------------------------------------------------------------

/**
 * Processa um único cupom: marca como processando, chama a Gemini API,
 * extrai dados e salva em cupons_lancamentos.
 *
 * @param {Object} supabase - Cliente Supabase.
 * @param {Object} cupom - Registro da tabela cupons_fila.
 */
async function processarCupom(supabase, cupom) {
  // --- a) Marcar como "processando" para evitar processamento duplo ---
  const { error: erroLock } = await supabase
    .from('cupons_fila')
    .update({ status: 'processando', atualizado_em: new Date().toISOString() })
    .eq('id', cupom.id)
    .eq('status', 'pendente'); // Garantir que ainda está pendente (lock otimista)

  if (erroLock) {
    throw new Error('Falha ao marcar como processando: ' + erroLock.message);
  }

  try {
    // --- b) Baixar a imagem do Supabase Storage ---
    const { data: imagemData, error: erroDownload } = await supabase.storage
      .from('cupons')
      .download(cupom.storage_path);

    if (erroDownload || !imagemData) {
      throw new Error('Falha ao baixar imagem do Storage: ' + (erroDownload?.message || 'dados vazios'));
    }

    // Converter o Blob para base64 para enviar à Gemini API
    const arrayBuffer = await imagemData.arrayBuffer();
    const base64Imagem = Buffer.from(arrayBuffer).toString('base64');

    // --- c) Enviar para a Gemini API com retry e backoff ---
    const dadosExtraidos = await chamarGeminiComRetry(base64Imagem, cupom.mime_type || 'image/jpeg');

    // --- d) Validar os dados extraídos ---
    if (!Array.isArray(dadosExtraidos) || dadosExtraidos.length === 0) {
      throw new Error('Gemini retornou dados inválidos.');
    }
    // Resposta sem nenhum campo útil não vale como leitura: tentar de novo
    if (!dadosExtraidos.some((d) => d.valor_total || d.estabelecimento)) {
      throw new Error('Gemini não conseguiu ler valor nem estabelecimento.');
    }

    // --- e) Inserir em cupons_lancamentos (um registro por cupom lido) ---
    const { error: erroInsert } = await supabase
      .from('cupons_lancamentos')
      .insert(dadosExtraidos.map((d) => ({
        cupom_id: cupom.id,
        cliente: cupom.cliente,
        data_emissao: d.data_emissao || null,
        estabelecimento: d.estabelecimento || null,
        cnpj: d.cnpj || null,
        valor_total: d.valor_total || null,
        forma_pagamento: d.forma_pagamento || null,
        categoria: d.categoria || null,
        resumo_itens: d.resumo_itens || null,
        dados_brutos_json: d.dados_brutos
      })));

    if (erroInsert) {
      throw new Error('Falha ao inserir lançamento: ' + erroInsert.message);
    }

    // --- f) Marcar cupom como "processado" ---
    await supabase
      .from('cupons_fila')
      .update({
        status: 'processado',
        ultimo_erro: null,
        atualizado_em: new Date().toISOString()
      })
      .eq('id', cupom.id);

    console.log(`[WORKER] ✅ Cupom ${cupom.id} processado com sucesso.`);

  } catch (erro) {
    // --- g) Tratar falha: incrementar tentativas ou enviar para revisão manual ---
    const novasTentativas = (cupom.tentativas || 0) + 1;

    if (novasTentativas >= WORKER_CONFIG.MAX_TENTATIVAS) {
      // Excedeu tentativas → revisão manual
      await supabase
        .from('cupons_fila')
        .update({
          status: 'revisao_manual',
          tentativas: novasTentativas,
          ultimo_erro: erro.message,
          atualizado_em: new Date().toISOString()
        })
        .eq('id', cupom.id);

      console.warn(`[WORKER] ⚠️ Cupom ${cupom.id} enviado para revisão manual após ${novasTentativas} tentativas.`);
    } else {
      // Ainda tem tentativas → devolver para a fila com atraso progressivo
      const atrasoMs = calcularBackoffFila(novasTentativas);
      const proximaTentativa = new Date(Date.now() + atrasoMs).toISOString();

      await supabase
        .from('cupons_fila')
        .update({
          status: 'pendente',
          tentativas: novasTentativas,
          proxima_tentativa_em: proximaTentativa,
          ultimo_erro: erro.message,
          atualizado_em: new Date().toISOString()
        })
        .eq('id', cupom.id);

      console.warn(`[WORKER] 🔄 Cupom ${cupom.id}: tentativa ${novasTentativas}, próxima em ${Math.round(atrasoMs / 1000)}s. Erro: ${erro.message}`);
    }

    // Re-lançar o erro para o controle do lote
    throw erro;
  }
}

// ---------------------------------------------------------------------------
// Chamada à Gemini API com retry e backoff exponencial
// ---------------------------------------------------------------------------

/**
 * Envia a imagem para a Gemini API e extrai dados do cupom fiscal.
 * Implementa retry com backoff exponencial para HTTP 503 e 429.
 *
 * @param {string} base64Imagem - Imagem em base64.
 * @param {string} mimeType - MIME type da imagem.
 * @returns {Promise<Object>} Dados estruturados extraídos do cupom.
 */
async function chamarGeminiComRetry(base64Imagem, mimeType) {
  const erros = [];
  for (const modelo of WORKER_CONFIG.GEMINI_MODELS) {
    try {
      return await chamarGeminiModelo(modelo, base64Imagem, mimeType);
    } catch (erro) {
      console.warn(`[GEMINI] ${modelo} falhou: ${erro.message.substring(0, 200)}`);
      erros.push(`${modelo}: ${erro.message.substring(0, 120)}`);
    }
  }
  throw new Error('Todos os modelos falharam. ' + erros.join(' | '));
}

async function chamarGeminiModelo(modelo, base64Imagem, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Variável GEMINI_API_KEY não configurada.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;

  // Prompt detalhado para extração de dados do cupom fiscal
  const prompt = `Você é um especialista em leitura de cupons fiscais brasileiros (NFC-e / CF-e / cupom térmico).
Analise a imagem do cupom fiscal e extraia os seguintes dados em formato JSON estrito.
Se algum campo não puder ser lido, use null.
Se houver mais de um cupom na mesma foto, responda uma LISTA de objetos, um por cupom.
Responda SOMENTE com o JSON, sem markdown, sem explicações, sem backticks.

Campos obrigatórios do JSON:
{
  "data_emissao": "YYYY-MM-DD (data de emissão do cupom)",
  "estabelecimento": "nome do estabelecimento que emitiu o cupom",
  "cnpj": "CNPJ do estabelecimento (somente números, 14 dígitos)",
  "valor_total": 0.00,
  "forma_pagamento": "dinheiro, cartão de crédito, cartão de débito, pix, etc.",
  "categoria": "classificação do tipo de compra: supermercado, frios, carnes, hortifruti, bebidas, embalagens, ingredientes, padaria, material de limpeza, descartáveis, outros",
  "resumo_itens": "resumo dos principais itens comprados, separados por vírgula (máximo 200 caracteres)",
  "itens": [
    {
      "nome": "nome limpo e legível do produto (sem códigos internos)",
      "quantidade": 1,
      "unidade": "un, kg, g, L, ml, pct, cx, fd, etc.",
      "valor_unitario": 0.00,
      "valor_total": 0.00
    }
  ]
}
Extraia TODOS os itens visíveis do cupom no array "itens". Se algum item não tiver quantidade/unidade legível, use quantidade 1 e unidade "un".`;

  // Tentativas com backoff para erros transitórios (503, 429)
  const maxTentativas = 1; // uma tentativa por modelo; o fallback é trocar de modelo
  let ultimoErro = null;

  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WORKER_CONFIG.GEMINI_TIMEOUT_MS);

      const resposta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Imagem
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,         // Baixa temperatura para respostas consistentes
            maxOutputTokens: 6144,    // suporta cupons longos com lista detalhada de itens
            responseMimeType: 'application/json'
          }
        })
      });

      clearTimeout(timeoutId);

      // Tratar erros HTTP transitórios (503 Service Unavailable, 429 Too Many Requests)
      if (resposta.status === 503 || resposta.status === 429) {
        const textoErro = await resposta.text().catch(() => '');
        ultimoErro = new Error(`Gemini API retornou HTTP ${resposta.status}: ${textoErro}`);

        // Calcular atraso com backoff + jitter antes de tentar novamente
        if (tentativa < maxTentativas - 1) {
          const atrasoMs = calcularBackoffGemini(tentativa);
          console.warn(`[GEMINI] HTTP ${resposta.status}. Aguardando ${Math.round(atrasoMs / 1000)}s antes da tentativa ${tentativa + 2}...`);
          await aguardar(atrasoMs);
          continue;
        }

        throw ultimoErro;
      }

      // Outros erros HTTP não transitórios
      if (!resposta.ok) {
        const textoErro = await resposta.text().catch(() => '');
        throw new Error(`Gemini API retornou HTTP ${resposta.status}: ${textoErro}`);
      }

      // Parsear resposta da Gemini API
      const resultado = await resposta.json();

      // Extrair o texto da resposta (estrutura da API Gemini)
      const textoResposta = resultado?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textoResposta) {
        throw new Error('Gemini não retornou texto na resposta. Possível imagem ilegível.');
      }

      // Parsear o JSON retornado pela Gemini
      return parsearRespostaGemini(textoResposta);

    } catch (erro) {
      ultimoErro = erro;

      // Se foi abort (timeout), não tentar novamente
      if (erro.name === 'AbortError') {
        throw new Error('Timeout na chamada à Gemini API (' + WORKER_CONFIG.GEMINI_TIMEOUT_MS + 'ms).');
      }

      // Se não é erro transitório e não é a última tentativa, ainda sim re-lançar
      if (tentativa >= maxTentativas - 1) {
        throw ultimoErro;
      }

      // Backoff antes da próxima tentativa
      const atrasoMs = calcularBackoffGemini(tentativa);
      console.warn(`[GEMINI] Erro: ${erro.message}. Aguardando ${Math.round(atrasoMs / 1000)}s...`);
      await aguardar(atrasoMs);
    }
  }

  throw ultimoErro || new Error('Falha na chamada à Gemini API após todas as tentativas.');
}

/**
 * Parseia e valida a resposta JSON da Gemini API.
 * Lida com possíveis formatações extras (markdown, espaços, etc.).
 *
 * @param {string} texto - Texto retornado pela Gemini API.
 * @returns {Object} Dados estruturados do cupom.
 */
function parsearRespostaGemini(texto) {
  // Remover possíveis backticks/markdown que a IA pode incluir
  let textoLimpo = texto.trim();

  // Remover bloco ```json ... ``` se existir
  if (textoLimpo.startsWith('```')) {
    textoLimpo = textoLimpo.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const bruto = JSON.parse(textoLimpo);

    // A foto pode ter mais de um cupom: o Gemini devolve uma lista nesse caso
    if (Array.isArray(bruto)) {
      if (bruto.length === 0) throw new Error('lista vazia');
      const lista = bruto.map(normalizarCupom);
      lista.forEach((c, i) => {
        c.dados_brutos = { ...(bruto[i] || {}), itens: c._itens };
        delete c._itens;
      });
      return lista;
    }
    const unico = normalizarCupom(bruto);
    unico.dados_brutos = { ...(bruto || {}), itens: unico._itens };
    delete unico._itens;
    return [unico];

  } catch (erroJson) {
    throw new Error('Resposta da Gemini não é JSON válido: ' + erroJson.message + '. Texto: ' + textoLimpo.substring(0, 200));
  }
}

function normalizarItens(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((it) => {
      if (!it || typeof it !== 'object') return null;
      const nome = typeof it.nome === 'string' ? it.nome.trim().slice(0, 140) : '';
      if (!nome) return null;
      const num = (v) => {
        if (typeof v === 'number' && !isNaN(v)) return v;
        if (typeof v === 'string') {
          const p = parseFloat(v.replace(/\./g, '').replace(',', '.'));
          return isNaN(p) ? null : p;
        }
        return null;
      };
      const qtd = num(it.quantidade);
      const unit = num(it.valor_unitario);
      const tot = num(it.valor_total);
      const unidade = typeof it.unidade === 'string' && it.unidade.trim() ? it.unidade.trim().slice(0, 16) : 'un';
      return {
        nome,
        quantidade: qtd !== null && qtd > 0 ? qtd : 1,
        unidade,
        valor_unitario: unit !== null && unit >= 0 ? unit : (tot !== null && qtd > 0 ? Number((tot / qtd).toFixed(2)) : null),
        valor_total: tot !== null && tot >= 0 ? tot : (unit !== null && qtd > 0 ? Number((unit * qtd).toFixed(2)) : 0)
      };
    })
    .filter(Boolean);
}

function normalizarCupom(dados) {
  const itens = normalizarItens(dados && dados.itens);
  let resumo = typeof dados.resumo_itens === 'string' ? dados.resumo_itens.trim().substring(0, 500) : null;
  if (!resumo && itens.length > 0) {
    resumo = itens.map((i) => i.nome).join(', ').substring(0, 500);
  }
  return {
    data_emissao: validarData(dados.data_emissao),
    estabelecimento: typeof dados.estabelecimento === 'string' ? dados.estabelecimento.trim() : null,
    cnpj: sanitizarCnpj(dados.cnpj),
    valor_total: typeof dados.valor_total === 'number' ? dados.valor_total : parseFloat(dados.valor_total) || null,
    forma_pagamento: typeof dados.forma_pagamento === 'string' ? dados.forma_pagamento.trim().toLowerCase() : null,
    categoria: typeof dados.categoria === 'string' ? dados.categoria.trim().toLowerCase() : null,
    resumo_itens: resumo,
    _itens: itens
  };
}

// ---------------------------------------------------------------------------
// Funções auxiliares
// ---------------------------------------------------------------------------

/**
 * Valida e formata uma data no formato YYYY-MM-DD.
 *
 * @param {string|null} valor - Data retornada pela IA.
 * @returns {string|null} Data validada ou null.
 */
function validarData(valor) {
  if (!valor || typeof valor !== 'string') return null;

  // Formato brasileiro DD/MM/YYYY
  const br = valor.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  // Tentar parsear a data
  const data = new Date(valor);
  if (isNaN(data.getTime())) return null;

  // Retornar no formato YYYY-MM-DD
  return data.toISOString().split('T')[0];
}

/**
 * Sanitiza CNPJ: mantém apenas dígitos e valida comprimento.
 *
 * @param {string|null} valor - CNPJ retornado pela IA.
 * @returns {string|null} CNPJ com 14 dígitos ou null.
 */
function sanitizarCnpj(valor) {
  if (!valor) return null;

  const apenasDigitos = String(valor).replace(/\D/g, '');
  return apenasDigitos.length === 14 ? apenasDigitos : (apenasDigitos.length > 0 ? apenasDigitos : null);
}

/**
 * Calcula backoff exponencial + jitter para retries da Gemini API.
 * Mais curto que o backoff da fila (aqui estamos dentro de uma execução).
 *
 * @param {number} tentativa - Número da tentativa (0, 1, 2...).
 * @returns {number} Atraso em milissegundos.
 */
function calcularBackoffGemini(tentativa) {
  const base = WORKER_CONFIG.BACKOFF_BASE_MS;
  const atraso = base * Math.pow(2, tentativa);        // 2s, 4s, 8s...
  const jitter = Math.random() * atraso * 0.3;         // até 30% de jitter
  return Math.min(atraso + jitter, 30000);              // máximo 30s por tentativa
}

/**
 * Calcula backoff exponencial para o campo proxima_tentativa_em da fila.
 * Progressivo para espaçar tentativas ao longo do tempo.
 *
 * @param {number} tentativas - Número de tentativas já realizadas.
 * @returns {number} Atraso em milissegundos.
 */
function calcularBackoffFila(tentativas) {
  // Progressão: 30s, 60s, 120s, 240s, 300s (máximo 5 min)
  const base = 30000;
  const atraso = base * Math.pow(2, tentativas - 1);
  const jitter = Math.random() * 10000;                // até 10s de jitter
  return Math.min(atraso + jitter, WORKER_CONFIG.BACKOFF_MAX_MS);
}

/**
 * Aguarda um tempo em milissegundos.
 *
 * @param {number} ms - Milissegundos para aguardar.
 * @returns {Promise<void>}
 */
function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
