// =============================================================================
// API/CONFIRMAR-ENTRADA.JS — Confirma um lançamento individual OU todos em lote
// (quando body.todas === true), sempre filtrado pelo cliente do usuário logado.
// POST { "id": "<uuid>", "categoria"?: "..." }  OU  { "todas": true }
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    return res.status(500).json({ erro: 'Variáveis do Supabase não configuradas.' });
  }

  const supabase = createClient(url, chave, { auth: { persistSession: false } });
  const cliente = await autenticar(req, res, supabase);
  if (!cliente) return;

  const body = req.body || {};

  // Confirmação em lote (substitui /api/confirmar-todas para manter o limite de 12 funções na Vercel)
  if (body.todas === true) {
    const { error } = await supabase
      .from('cupons_lancamentos')
      .update({
        status_revisao: 'confirmado',
        revisado_em: new Date().toISOString()
      })
      .neq('status_revisao', 'confirmado')
      .eq('cliente', cliente.nome);

    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ mensagem: 'Todas as entradas foram confirmadas!' });
  }

  const entradaId = body.id;
  const novaCategoria = body.categoria;
  if (!entradaId) {
    return res.status(400).json({ erro: 'Código do lançamento inválido.' });
  }

  const patchData = {
    status_revisao: 'confirmado',
    revisado_em: new Date().toISOString()
  };
  if (novaCategoria) {
    patchData.categoria = String(novaCategoria).slice(0, 50);
  }

  const { data, error } = await supabase
    .from('cupons_lancamentos')
    .update(patchData)
    .eq('id', entradaId)
    .eq('cliente', cliente.nome)
    .select('id');

  if (error) return res.status(500).json({ erro: error.message });
  if (!data || data.length === 0) {
    return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  }

  return res.status(200).json({ mensagem: 'Entrada confirmada com sucesso!' });
}
