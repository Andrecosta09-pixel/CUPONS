// =============================================================================
// API/IMAGEM-CUPOM.JS — Serve imagem privada do Storage apenas para o dono.
// GET /api/imagem-cupom?path=<slug-cliente>/<YYYY-MM>/<uuid>.jpg
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { autenticar } from './_auth.js';

function slugCliente(cliente) {
  return String(cliente || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

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

  const caminho = String((req.query && req.query.path) || '');
  const prefixo = slugCliente(cliente.nome) + '/';
  if (!caminho || caminho.includes('..') || !caminho.startsWith(prefixo)) {
    return res.status(404).end();
  }

  const { data, error } = await supabase.storage.from('cupons').download(caminho);
  if (error || !data) {
    return res.status(404).end();
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).send(buffer);
}
