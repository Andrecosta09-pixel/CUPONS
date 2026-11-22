// =============================================================================
// API/ADMIN.JS — Ambiente administrativo: gestão de clientes, convites e
// controle de uso (envios no mês, cupons lidos, erros, armazenamento, limites).
// Acesso estritamente restrito a usuários com eh_admin === true.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

function inicioMesIso() {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    return res.status(500).json({ erro: 'Variáveis do Supabase não configuradas.' });
  }

  const supabase = createClient(url, chave, { auth: { persistSession: false } });
  const admin = await autenticar(req, res, supabase);
  if (!admin) return;

  if (!admin.eh_admin) {
    return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
  }

  // ---- GET: resumo de uso + lista de clientes ----
  if (req.method === 'GET') {
    try {
      let clientes = [];
      let colunasAdminOk = true;
      const q1 = await supabase
        .from('clientes')
        .select('id, nome, email, ativo, eh_admin, limite_mensal_envios, criado_em')
        .order('nome', { ascending: true });

      if (q1.error) {
        colunasAdminOk = false;
        const q2 = await supabase
          .from('clientes')
          .select('id, nome, email, ativo, criado_em')
          .order('nome', { ascending: true });
        if (q2.error) throw q2.error;
        clientes = (q2.data || []).map((c) => ({ ...c, eh_admin: c.email === admin.email, limite_mensal_envios: null }));
      } else {
        clientes = q1.data || [];
      }

      const [resFila, resLanc, resAuth] = await Promise.all([
        supabase.from('cupons_fila').select('cliente, status, tamanho_comprimido_bytes, criado_em'),
        supabase.from('cupons_lancamentos').select('cliente, valor_total, criado_em'),
        supabase.auth.admin.listUsers({ perPage: 200 })
      ]);

      const fila = resFila.data || [];
      const lancs = resLanc.data || [];
      const authUsers = (resAuth.data && resAuth.data.users) || [];
      const authPorEmail = new Map(authUsers.map((u) => [String(u.email || '').toLowerCase(), u]));
      const iniMes = inicioMesIso();

      const usoPorCliente = new Map();
      const garantir = (nome) => {
        if (!usoPorCliente.has(nome)) {
          usoPorCliente.set(nome, { envios_mes: 0, envios_total: 0, erros_fila: 0, bytes: 0, ultimo_envio: null, lancamentos_total: 0, valor_total: 0 });
        }
        return usoPorCliente.get(nome);
      };

      let totalEnviosMes = 0;
      let totalBytes = 0;
      let totalErros = 0;

      for (const f of fila) {
        const u = garantir(f.cliente);
        u.envios_total += 1;
        const b = Number(f.tamanho_comprimido_bytes) || 0;
        u.bytes += b;
        totalBytes += b;
        if (f.criado_em && f.criado_em >= iniMes) {
          u.envios_mes += 1;
          totalEnviosMes += 1;
        }
        if (f.status === 'revisao_manual') {
          u.erros_fila += 1;
          totalErros += 1;
        }
        if (f.criado_em && (!u.ultimo_envio || f.criado_em > u.ultimo_envio)) {
          u.ultimo_envio = f.criado_em;
        }
      }

      for (const l of lancs) {
        const u = garantir(l.cliente);
        u.lancamentos_total += 1;
        u.valor_total += Number(l.valor_total) || 0;
      }

      const lista = clientes.map((c) => {
        const em = c.email ? String(c.email).toLowerCase() : null;
        const au = em ? authPorEmail.get(em) : null;
        const uso = usoPorCliente.get(c.nome) || { envios_mes: 0, envios_total: 0, erros_fila: 0, bytes: 0, ultimo_envio: null, lancamentos_total: 0, valor_total: 0 };
        let situacao = 'sem_email';
        if (!c.ativo) situacao = 'bloqueado';
        else if (em && au && au.email_confirmed_at) situacao = 'ativo';
        else if (em) situacao = 'convite_pendente';

        return {
          id: c.id,
          nome: c.nome,
          email: em,
          ativo: Boolean(c.ativo),
          eh_admin: Boolean(c.eh_admin),
          limite_mensal_envios: typeof c.limite_mensal_envios === 'number' ? c.limite_mensal_envios : null,
          situacao,
          ultimo_acesso: au ? au.last_sign_in_at : null,
          uso
        };
      });

      return res.status(200).json({
        colunas_admin_ok: colunasAdminOk,
        resumo: {
          clientes_ativos: lista.filter((c) => c.ativo).length,
          clientes_total: lista.length,
          envios_mes: totalEnviosMes,
          envios_total: fila.length,
          lancamentos_total: lancs.length,
          erros_fila: totalErros,
          bytes_total: totalBytes
        },
        clientes: lista
      });
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  // ---- POST: ações administrativas ----
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const body = req.body || {};
  const acao = String(body.acao || '');
  const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : '');

  try {
    // 1. Convidar novo cliente ou vincular e-mail a cliente existente
    if (acao === 'convidar') {
      const email = String(body.email || '').trim().toLowerCase();
      const nome = String(body.nome || '').trim().slice(0, 120);
      const clienteId = body.cliente_id || null;
      const limiteRaw = body.limite_mensal_envios;
      const limite = limiteRaw === '' || limiteRaw == null ? null : Math.max(1, parseInt(limiteRaw, 10) || 1);

      if (!email || !email.includes('@')) {
        return res.status(400).json({ erro: 'Informe um e-mail válido.' });
      }
      if (!clienteId && !nome) {
        return res.status(400).json({ erro: 'Informe o nome do cliente.' });
      }

      if (clienteId) {
        const patch = { email, ativo: true };
        if (limiteRaw !== undefined) patch.limite_mensal_envios = limite;
        const { error } = await supabase.from('clientes').update(patch).eq('id', clienteId);
        if (error) {
          // fallback se coluna limite_mensal_envios ainda não existir
          const { error: e2 } = await supabase.from('clientes').update({ email, ativo: true }).eq('id', clienteId);
          if (e2) return res.status(400).json({ erro: e2.message });
        }
      } else {
        const novo = { nome, email, ativo: true };
        if (limite !== null) novo.limite_mensal_envios = limite;
        const { error } = await supabase.from('clientes').insert(novo);
        if (error) {
          const { error: e2 } = await supabase.from('clientes').insert({ nome, email, ativo: true });
          if (e2) return res.status(400).json({ erro: e2.message });
        }
      }

      // Dispara convite oficial no Supabase Auth
      const { error: errInvite } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: origin || undefined
      });
      if (errInvite && !String(errInvite.message || '').toLowerCase().includes('already')) {
        return res.status(200).json({
          mensagem: `Cliente salvo, mas o envio do e-mail retornou aviso: ${errInvite.message}. O usuário pode usar "Esqueci minha senha".`
        });
      }

      return res.status(200).json({ mensagem: `Convite enviado para ${email} e acesso liberado.` });
    }

    // 2. Reenviar convite / link de acesso
    if (acao === 'reenviar_convite') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ erro: 'Cliente sem e-mail cadastrado.' });
      const { error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: origin || undefined });
      if (error) {
        // Se já está confirmado, envia link de recuperação para redefinir senha
        const r = await supabase.auth.resetPasswordForEmail(email, { redirectTo: origin || undefined });
        if (r.error) return res.status(400).json({ erro: r.error.message });
        return res.status(200).json({ mensagem: `Link de redefinição de senha enviado para ${email}.` });
      }
      return res.status(200).json({ mensagem: `Convite reenviado para ${email}.` });
    }

    // 3. Bloquear / Reativar cliente
    if (acao === 'alternar_ativo') {
      const id = body.cliente_id;
      const ativo = Boolean(body.ativo);
      if (!id) return res.status(400).json({ erro: 'Cliente inválido.' });
      if (id === admin.id && !ativo) {
        return res.status(400).json({ erro: 'Você não pode bloquear sua própria conta de administrador.' });
      }
      const { error } = await supabase.from('clientes').update({ ativo }).eq('id', id);
      if (error) return res.status(500).json({ erro: error.message });
      return res.status(200).json({ mensagem: ativo ? 'Acesso do cliente reativado.' : 'Acesso do cliente bloqueado.' });
    }

    // 4. Atualizar limite mensal de envios
    if (acao === 'atualizar_limite') {
      const id = body.cliente_id;
      const raw = body.limite_mensal_envios;
      const limite = raw === '' || raw == null ? null : Math.max(1, parseInt(raw, 10) || 1);
      if (!id) return res.status(400).json({ erro: 'Cliente inválido.' });
      const { error } = await supabase.from('clientes').update({ limite_mensal_envios: limite }).eq('id', id);
      if (error) {
        return res.status(400).json({ erro: 'Rode o SQL schema_v5_admin.sql no Supabase para ativar o limite mensal.' });
      }
      return res.status(200).json({ mensagem: limite ? `Limite ajustado para ${limite} envios/mês.` : 'Limite mensal removido (ilimitado).' });
    }

    return res.status(400).json({ erro: 'Ação administrativa inválida.' });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
