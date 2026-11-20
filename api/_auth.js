// =============================================================================
// API/_AUTH.JS — Valida o login (Supabase Auth) e acha o cliente do usuário.
// Arquivo com "_" não vira rota na Vercel; é só um módulo compartilhado.
//
// Uso:  const cliente = await autenticar(req, res, supabase);
//       if (!cliente) return;   // já respondeu 401/403
// =============================================================================

/**
 * @param {Object} req - Requisição (lê o header Authorization: Bearer <token>).
 * @param {Object} res - Resposta (usada para responder 401/403/503).
 * @param {Object} supabase - Cliente Supabase com service_role.
 * @returns {Promise<{id: string, nome: string, email: string} | null>}
 */
export async function autenticar(req, res, supabase) {
  const cab = req.headers['authorization'] || '';
  if (!cab.startsWith('Bearer ') || cab.length < 20) {
    res.status(401).json({ erro: 'Entre para continuar.' });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(cab.slice(7).trim());
  const usuario = data && data.user;
  if (error || !usuario) {
    res.status(401).json({ erro: 'Sessão inválida ou expirada. Entre de novo.' });
    return null;
  }

  const email = String(usuario.email || '').trim().toLowerCase();
  if (!email || !usuario.email_confirmed_at) {
    res.status(401).json({ erro: 'E-mail ainda não confirmado.' });
    return null;
  }

  const { data: achados, error: erroBanco } = await supabase
    .from('clientes')
    .select('id, nome, email')
    .eq('email', email)
    .eq('ativo', true)
    .limit(1);

  if (erroBanco) {
    res.status(503).json({ erro: 'Não foi possível consultar o cadastro agora. Tente de novo.' });
    return null;
  }
  if (!achados || achados.length === 0) {
    res.status(403).json({ erro: 'Seu acesso ainda não foi liberado. Fale com o administrador.' });
    return null;
  }
  return achados[0];
}
