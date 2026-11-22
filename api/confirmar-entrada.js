// =============================================================================
// API/CONFIRMAR-ENTRADA.JS — Confirma um lançamento (e opcionalmente atualiza
// sua categoria), garantindo isolamento pelo cliente do usuário logado.
// POST { "id": "<uuid>", "categoria": "<opcional>" }
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const body = req.body || {};
  const entradaId = body.id;
  const novaCategoria = body.categoria;

  if (!entradaId) {
    return res.status(400).json({ erro: 'Código do lançamento inválido.' });
  }

  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    return res.status(500).json({ erro: 'Variáveis do Supabase não configuradas.' });
  }

  const supabase = createClient(url, chave, { auth: { persistSession: false } });
  const cliente = await autenticar(req, res, supabase);
  if (!cliente) return;

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

  if (error) {
    return res.status(500).json({ erro: error.message });
  }
  if (!data || data.length === 0) {
    return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  }

  return res.status(200).json({ mensagem: 'Entrada confirmada com sucesso!' });
}
