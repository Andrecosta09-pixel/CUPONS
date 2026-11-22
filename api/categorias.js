// =============================================================================
// API/CATEGORIAS.JS — Lista as categorias disponíveis (exige login).
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

const CATEGORIAS_PADRAO = [
  { nome: 'Mercado' },
  { nome: 'Obra / construção' },
  { nome: 'Combustível' },
  { nome: 'Alimentação' },
  { nome: 'Farmácia / saúde' },
  { nome: 'Casa / utilidades' },
  { nome: 'Serviços' },
  { nome: 'Outros' }
];

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
    .from('categorias')
    .select('*')
    .order('nome', { ascending: true });

  if (error || !data) {
    return res.status(200).json(CATEGORIAS_PADRAO);
  }

  return res.status(200).json(data);
}
