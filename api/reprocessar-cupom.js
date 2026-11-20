// =============================================================================
// API/REPROCESSAR-CUPOM.JS — Devolve um envio em "revisao_manual" para a fila.
// O cron (/api/processar-fila, a cada 3 min) faz a leitura de novo.
// POST { "id": "<uuid do envio>" }
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const id = req.body && req.body.id;
  if (!id || !UUID.test(id)) {
    return res.status(400).json({ erro: 'Código do envio inválido.' });
  }

  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    return res.status(500).json({ erro: 'Variáveis do Supabase não configuradas.' });
  }

  const supabase = createClient(url, chave, { auth: { persistSession: false } });
  const cliente = await autenticar(req, res, supabase);
  if (!cliente) return;

  // Só envios que precisam de revisão voltam para a fila
  const { data, error } = await supabase
    .from('cupons_fila')
    .update({
      status: 'pendente',
      tentativas: 0,
      proxima_tentativa_em: null,
      ultimo_erro: null,
      atualizado_em: new Date().toISOString()
    })
    .eq('id', id)
    .eq('cliente', cliente.nome)
    .eq('status', 'revisao_manual')
    .select('id');

  if (error) return res.status(500).json({ erro: error.message });
  if (!data || data.length === 0) {
    return res.status(409).json({ erro: 'Só é possível tentar de novo os envios que precisam de revisão.' });
  }
  return res.status(200).json({ mensagem: 'Envio devolvido à fila.' });
}
