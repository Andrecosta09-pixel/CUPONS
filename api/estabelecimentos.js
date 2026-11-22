// =============================================================================
// API/ESTABELECIMENTOS.JS — Lista e salva regras de normalização de
// estabelecimentos/filiais (Nome Canônico por CNPJ/raiz/nome) do cliente logado.
// GET  /api/estabelecimentos
// POST /api/estabelecimentos { nome_atual, nome_canonico, cnpj?, agrupar_filiais? }
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';
import { sanitizarCnpj, raizCnpj, semAcento, limparNomeEstabelecimento } from './_normalizador.js';

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    return res.status(500).json({ erro: 'Variáveis do Supabase não configuradas.' });
  }

  const supabase = createClient(url, chave, { auth: { persistSession: false } });
  const cliente = await autenticar(req, res, supabase);
  if (!cliente) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('estabelecimentos_regras')
      .select('id, cnpj, cnpj_raiz, padrao_nome, nome_canonico, atualizado_em')
      .eq('cliente', cliente.nome)
      .order('nome_canonico', { ascending: true });

    if (error) return res.status(200).json([]);
    return res.status(200).json(data || []);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const body = req.body || {};
  const nomeCanonico = String(body.nome_canonico || '').trim().slice(0, 120);
  const nomeAtual = String(body.nome_atual || '').trim();
  const cnpjLimpo = sanitizarCnpj(body.cnpj);
  const raiz = cnpjLimpo ? raizCnpj(cnpjLimpo) : null;
  const agruparFiliais = body.agrupar_filiais !== false; // padrão: agrupa filiais da mesma raiz de CNPJ
  const lancamentoId = body.lancamento_id || null;

  if (!nomeCanonico) {
    return res.status(400).json({ erro: 'Informe o novo nome do estabelecimento.' });
  }

  try {
    // 1. Salvar ou atualizar regra persistente para compras futuras (best-effort se tabela existir)
    const padraoNome = nomeAtual ? semAcento(limparNomeEstabelecimento(nomeAtual)) : null;
    try {
      if (raiz && agruparFiliais) {
        await supabase
          .from('estabelecimentos_regras')
          .upsert(
            {
              cliente: cliente.nome,
              cnpj: cnpjLimpo,
              cnpj_raiz: raiz,
              padrao_nome: padraoNome,
              nome_canonico: nomeCanonico,
              atualizado_em: new Date().toISOString()
            },
            { onConflict: 'cliente,cnpj_raiz' }
          );
      } else if (padraoNome) {
        const { data: existente } = await supabase
          .from('estabelecimentos_regras')
          .select('id')
          .eq('cliente', cliente.nome)
          .is('cnpj_raiz', null)
          .eq('padrao_nome', padraoNome)
          .limit(1);

        if (existente && existente.length > 0) {
          await supabase
            .from('estabelecimentos_regras')
            .update({ nome_canonico: nomeCanonico, atualizado_em: new Date().toISOString() })
            .eq('id', existente[0].id);
        } else {
          await supabase.from('estabelecimentos_regras').insert({
            cliente: cliente.nome,
            cnpj: cnpjLimpo,
            cnpj_raiz: null,
            padrao_nome: padraoNome,
            nome_canonico: nomeCanonico
          });
        }
      }
    } catch (_) {
      // Se a tabela ainda não foi criada, ainda atualiza os lançamentos existentes abaixo
    }

    // 2. Atualizar lançamentos existentes do cliente que correspondam ao CNPJ/raiz ou nome atual
    let atualizados = 0;
    const { data: todos, error: errBusca } = await supabase
      .from('cupons_lancamentos')
      .select('id, estabelecimento, cnpj')
      .eq('cliente', cliente.nome);

    if (errBusca) {
      return res.status(500).json({ erro: errBusca.message });
    }

    const idsAlvo = (todos || [])
      .filter((l) => {
        if (lancamentoId && l.id === lancamentoId) return true;
        const lCnpj = sanitizarCnpj(l.cnpj);
        if (raiz && agruparFiliais && lCnpj && lCnpj.startsWith(raiz)) return true;
        if (cnpjLimpo && lCnpj === cnpjLimpo) return true;
        if (nomeAtual && semAcento(l.estabelecimento) === semAcento(nomeAtual)) return true;
        return false;
      })
      .map((l) => l.id);

    if (idsAlvo.length > 0) {
      const { error: errUp } = await supabase
        .from('cupons_lancamentos')
        .update({ estabelecimento: nomeCanonico })
        .in('id', idsAlvo)
        .eq('cliente', cliente.nome);

      if (errUp) return res.status(500).json({ erro: errUp.message });
      atualizados = idsAlvo.length;
    }

    return res.status(200).json({
      mensagem: `Estabelecimento atualizado para "${nomeCanonico}".`,
      nome_canonico: nomeCanonico,
      atualizados
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
