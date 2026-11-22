// =============================================================================
// API/NOVAS-ENTRADAS.JS — Lista lançamentos de cupons filtrados pelo cliente.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
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

  const { data, error } = await supabase
    .from('cupons_lancamentos')
    .select('*')
    .eq('cliente', cliente.nome)
    .order('criado_em', { ascending: false })
    .limit(1000);

  if (error) {
    return res.status(500).json({ erro: error.message });
  }

  return res.status(200).json(data || []);
}
