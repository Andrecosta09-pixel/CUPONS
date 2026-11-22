// =============================================================================
// API/CONFIRMAR-TODAS.JS — Confirma em lote todas as entradas pendentes do
// cliente do usuário logado.
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

  const { error } = await supabase
    .from('cupons_lancamentos')
    .update({
      status_revisao: 'confirmado',
      revisado_em: new Date().toISOString()
    })
    .neq('status_revisao', 'confirmado')
    .eq('cliente', cliente.nome);

  if (error) {
    return res.status(500).json({ erro: error.message });
  }

  return res.status(200).json({ mensagem: 'Todas as entradas foram confirmadas!' });
}
