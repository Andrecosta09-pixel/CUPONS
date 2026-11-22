// =============================================================================
// API/_AUTH.JS — Valida o login (Supabase Auth) e acha o cliente do usuário.
// Arquivo com "_" não vira rota na Vercel; é só um módulo compartilhado.
//
// Uso:  const cliente = await autenticar(req, res, supabase);
//       if (!cliente) return;   // já respondeu 401/403
// =============================================================================

const ADMIN_FALLBACK_EMAIL = 'trab.andrecosta@gmail.com';

/**
 * @param {Object} req - Requisição (lê o header Authorization: Bearer <token>).
 * @param {Object} res - Resposta (usada para responder 401/403/503).
 * @param {Object} supabase - Cliente Supabase com service_role.
 * @returns {Promise<{id: string, nome: string, email: string, eh_admin: boolean, limite_mensal_envios: number|null} | null>}
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

  // Tenta ler com as colunas novas (eh_admin, limite_mensal_envios); fallback se schema_v5 ainda não foi aplicado
  let achados = null;
  let erroBanco = null;
  let usouFallback = false;

  const q1 = await supabase
    .from('clientes')
    .select('id, nome, email, eh_admin, limite_mensal_envios')
    .eq('email', email)
    .eq('ativo', true)
    .limit(1);

  if (q1.error) {
    usouFallback = true;
    const q2 = await supabase
      .from('clientes')
      .select('id, nome, email')
      .eq('email', email)
      .eq('ativo', true)
      .limit(1);
    achados = q2.data;
    erroBanco = q2.error;
  } else {
    achados = q1.data;
  }

  if (erroBanco) {
    res.status(503).json({ erro: 'Não foi possível consultar o cadastro agora. Tente de novo.' });
    return null;
  }
  if (!achados || achados.length === 0) {
    res.status(403).json({ erro: 'Seu acesso ainda não foi liberado. Fale com o administrador.' });
    return null;
  }

  const c = achados[0];
  return {
    id: c.id,
    nome: c.nome,
    email: c.email,
    eh_admin: usouFallback ? (email === ADMIN_FALLBACK_EMAIL) : Boolean(c.eh_admin),
    limite_mensal_envios: typeof c.limite_mensal_envios === 'number' ? c.limite_mensal_envios : null
  };
}
