// =============================================================================
// API/CONFIG.JS — Configuração pública para o login (Supabase Auth).
// URL e chave anon são públicas por natureza; a segurança vem do RLS + _auth.js.
// =============================================================================

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ erro: 'Configuração pública do Supabase ausente.' });
  }

  return res.status(200).json({ supabaseUrl, anonKey });
}
