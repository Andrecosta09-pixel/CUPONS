// =============================================================================
// AUTH.JS — Login com Supabase Auth (e-mail + senha), primeiro acesso por convite
// e "esqueci minha senha". Sem biblioteca: usa a API REST do Supabase.
//
// Fluxo:
//   - Admin convida o e-mail no painel do Supabase (Authentication > Users).
//   - O usuário abre o link do e-mail, cai aqui com #access_token=...&type=invite
//     e cria a senha ("Crie sua senha"). Depois entra direto.
//   - Toda chamada a /api/* leva "Authorization: Bearer <token>" (fetch é envolvido aqui).
//   - Sem sessão válida, só a tela de login aparece. O app só inicia após o login
//     (window.iniciarApp, definido em app.js).
// =============================================================================
(function () {
  const CHAVE = 'cupons-sessao';
  const AVISO = 'cupons-aviso-login';
  const fetchOriginal = window.fetch.bind(window);
  let config = null;
  let cliente = null;
  let sessao = lerSessao();

  const $ = (id) => document.getElementById(id);
  const ic = (n, x = '') => `<svg class="ic${x}" aria-hidden="true"><use href="/icons.svg#i-${n}"/></svg>`;

  function lerSessao() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { return null; }
  }
  function gravarSessao(s) {
    sessao = s;
    try { if (s) localStorage.setItem(CHAVE, JSON.stringify(s)); else localStorage.removeItem(CHAVE); } catch (e) { /* modo privado */ }
  }
  function sessaoDe(resp) {
    return {
      access_token: resp.access_token,
      refresh_token: resp.refresh_token,
      expires_at: resp.expires_at ? resp.expires_at * 1000 : Date.now() + (resp.expires_in || 3600) * 1000
    };
  }

  async function carregarConfig() {
    if (config) return config;
    const r = await fetchOriginal('/api/config');
    if (!r.ok) throw new Error('config');
    config = await r.json();
    if (!config.supabaseUrl || !config.anonKey) throw new Error('config');
    return config;
  }

  async function authApi(caminho, { metodo = 'POST', corpo, token } = {}) {
    const c = await carregarConfig();
    const r = await fetchOriginal(`${c.supabaseUrl}/auth/v1${caminho}`, {
      method: metodo,
      headers: { apikey: c.anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    let dados = {};
    try { dados = await r.json(); } catch (e) { /* sem corpo */ }
    return { ok: r.ok, status: r.status, dados };
  }

  // ---- token sempre válido (renova 60 s antes de vencer) ----
  async function tokenValido() {
    if (!sessao) throw new Error('sem-sessao');
    if (sessao.expires_at - Date.now() > 60000) return sessao.access_token;
    const r = await authApi('/token?grant_type=refresh_token', { corpo: { refresh_token: sessao.refresh_token } });
    if (!r.ok) { encerrar('Sua sessão expirou. Entre de novo.'); throw new Error('sessao-expirada'); }
    gravarSessao(sessaoDe(r.dados));
    return sessao.access_token;
  }

  // ---- fetch com login nas rotas /api/ (menos /api/config) ----
  window.fetch = async function (entrada, opcoes = {}) {
    const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
    if (!url.startsWith('/api/') || url.startsWith('/api/config')) return fetchOriginal(entrada, opcoes);
    const token = await tokenValido();
    const res = await fetchOriginal(entrada, { ...opcoes, headers: { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` } });
    if (res.status === 401) encerrar('Sua sessão expirou. Entre de novo.');
    return res;
  };

  // ---- imagens protegidas: <img> não manda token, então baixamos como blob ----
  const blobs = new Map();
  window.imagemProtegida = async function (url) {
    if (blobs.has(url)) return blobs.get(url);
    const r = await window.fetch(url);
    if (!r.ok) throw new Error('imagem');
    const obj = URL.createObjectURL(await r.blob());
    blobs.set(url, obj);
    return obj;
  };
  window.preencherImagens = function (raiz) {
    (raiz || document).querySelectorAll('img[data-src-protegida]').forEach(async (img) => {
      const u = img.dataset.srcProtegida;
      try { img.src = await window.imagemProtegida(u); img.removeAttribute('data-src-protegida'); } catch (e) { img.alt = 'Não foi possível carregar a foto.'; }
    });
  };

  window.usuarioLogado = () => cliente;

  // ---- sair ----
  function encerrar(aviso) {
    const token = sessao && sessao.access_token;
    gravarSessao(null);
    try { sessionStorage.setItem(AVISO, aviso || 'Sessão encerrada com segurança.'); } catch (e) { /* ignore */ }
    if (token) authApi('/logout', { token }).catch(() => {});
    location.replace('/');
  }
  window.sairDoSistema = () => encerrar('Sessão encerrada com segurança.');

  // ---- telas ----
  const SECAO = { login: 'auth-login', senha: 'auth-secao-senha', esqueci: 'auth-esqueci' };
  function mostrarTela(nome) {
    Object.keys(SECAO).forEach((t) => { const el = $(SECAO[t]); if (el) el.hidden = t !== nome; });
    mensagem('');
    const alvo = { login: 'auth-email', senha: 'auth-nova', esqueci: 'auth-email2' }[nome];
    if (alvo && $(alvo)) $(alvo).focus();
  }
  function mensagem(texto, tipo = 'erro') {
    const m = $('auth-msg');
    if (!m) return;
    m.hidden = !texto;
    m.className = `auth-msg auth-msg--${tipo}`;
    m.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    m.innerHTML = texto ? `${ic(tipo === 'erro' ? 'circle-alert' : 'circle-check')}<span>${texto}</span>` : '';
  }
  function ocupado(botao, sim, textoOcupado) {
    if (sim) { botao.dataset.rotulo = botao.innerHTML; botao.disabled = true; botao.textContent = textoOcupado; }
    else { botao.disabled = false; botao.innerHTML = botao.dataset.rotulo || botao.innerHTML; }
  }

  function mostrarApp(c) {
    cliente = c;
    $('tela-auth').hidden = true;
    $('app-shell').hidden = false;
    $('usuario-nome').textContent = c.nome;
    $('usuario-nome').title = c.email;
    $('usuario-inicial').textContent = (c.nome || '?').trim().charAt(0).toUpperCase();
    if (typeof window.iniciarApp === 'function') window.iniciarApp();
  }

  async function entrarComSessao() {
    try {
      const r = await window.fetch('/api/eu');
      if (r.status === 403) {
        const msg = (await r.json().catch(() => ({}))).erro || 'Seu acesso ainda não foi liberado.';
        gravarSessao(null);
        $('tela-auth').hidden = false; $('app-shell').hidden = true;
        mostrarTela('login');
        mensagem(msg);
        return;
      }
      if (!r.ok) throw new Error('eu');
      mostrarApp(await r.json());
    } catch (e) {
      if (!sessao) return; // encerrar() já cuidou
      $('tela-auth').hidden = false; $('app-shell').hidden = true;
      mostrarTela('login');
      mensagem('Não foi possível entrar agora. Confira a internet e tente de novo.');
    }
  }

  // ---- ações dos formulários ----
  async function aoEntrar(ev) {
    ev.preventDefault();
    const email = $('auth-email').value.trim().toLowerCase();
    const senha = $('auth-senha').value;
    if (!email || !senha) { mensagem('Informe o e-mail e a senha.'); (email ? $('auth-senha') : $('auth-email')).focus(); return; }
    const btn = $('auth-entrar');
    ocupado(btn, true, 'Entrando…');
    try {
      const r = await authApi('/token?grant_type=password', { corpo: { email, password: senha } });
      if (!r.ok) {
        mensagem(r.status === 400 || r.status === 401 ? 'E-mail ou senha incorretos. Confira e tente de novo.' : 'Não foi possível entrar agora. Tente de novo em instantes.');
        return;
      }
      gravarSessao(sessaoDe(r.dados));
      $('auth-senha').value = '';
      await entrarComSessao();
    } catch (e) {
      mensagem('Não foi possível entrar agora. Confira a internet e tente de novo.');
    } finally { ocupado(btn, false); }
  }

  async function aoCriarSenha(ev) {
    ev.preventDefault();
    const nova = $('auth-nova').value, conf = $('auth-conf').value;
    if (nova.length < 8) { mensagem('A senha precisa ter pelo menos 8 caracteres.'); $('auth-nova').focus(); return; }
    if (nova !== conf) { mensagem('As duas senhas são diferentes. Digite de novo.'); $('auth-conf').focus(); return; }
    const btn = $('auth-salvar-senha');
    ocupado(btn, true, 'Salvando…');
    try {
      const r = await authApi('/user', { metodo: 'PUT', corpo: { password: nova }, token: sessao.access_token });
      if (!r.ok) {
        const m = (r.dados && (r.dados.msg || r.dados.message || r.dados.error_description)) || '';
        mensagem(/same|different/i.test(m) ? 'Escolha uma senha diferente da anterior.' : (/weak|short|least/i.test(m) ? 'Senha fraca. Use 8 ou mais caracteres, misturando letras e números.' : 'Não foi possível salvar a senha. Peça um novo link ao administrador.'));
        return;
      }
      $('auth-nova').value = ''; $('auth-conf').value = '';
      await entrarComSessao();
    } catch (e) {
      mensagem('Não foi possível salvar a senha agora. Tente de novo.');
    } finally { ocupado(btn, false); }
  }

  async function aoEsqueci(ev) {
    ev.preventDefault();
    const email = $('auth-email2').value.trim().toLowerCase();
    if (!email) { mensagem('Informe o e-mail cadastrado.'); $('auth-email2').focus(); return; }
    const btn = $('auth-enviar-link');
    ocupado(btn, true, 'Enviando…');
    try {
      await authApi('/recover?redirect_to=' + encodeURIComponent(location.origin + '/'), { corpo: { email } });
      // Mesma resposta exista ou não o e-mail (não revela quem tem cadastro)
      mensagem('Se esse e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Confira também o spam.', 'ok');
    } catch (e) {
      mensagem('Não foi possível enviar agora. Tente de novo em instantes.');
    } finally { ocupado(btn, false); }
  }

  function ligarOlho(botaoId, campoId) {
    const b = $(botaoId), c = $(campoId);
    if (!b || !c) return;
    b.addEventListener('click', () => {
      const ver = c.type === 'password';
      c.type = ver ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(ver));
      b.setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
      b.innerHTML = ic(ver ? 'eye-off' : 'eye');
    });
  }

  // ---- início ----
  document.addEventListener('DOMContentLoaded', async () => {
    $('auth-form-login').addEventListener('submit', aoEntrar);
    $('auth-form-senha').addEventListener('submit', aoCriarSenha);
    $('auth-form-esqueci').addEventListener('submit', aoEsqueci);
    $('auth-ir-esqueci').addEventListener('click', () => { $('auth-email2').value = $('auth-email').value; mostrarTela('esqueci'); });
    $('auth-voltar').addEventListener('click', () => mostrarTela('login'));
    ligarOlho('auth-olho', 'auth-senha');
    ligarOlho('auth-olho2', 'auth-nova');
    $('btn-sair').addEventListener('click', window.sairDoSistema);

    // Link do e-mail (convite ou redefinição): vem no # da URL
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hash.get('access_token') && ['invite', 'recovery', 'signup', 'magiclink'].includes(hash.get('type'))) {
      gravarSessao(sessaoDe({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_in: Number(hash.get('expires_in')) || 3600 }));
      history.replaceState(null, '', location.pathname);
      $('tela-auth').hidden = false;
      mostrarTela('senha');
      return;
    }
    if (hash.get('error_description')) {
      history.replaceState(null, '', location.pathname);
      $('tela-auth').hidden = false;
      mostrarTela('login');
      mensagem('Esse link venceu ou já foi usado. Use "Esqueci minha senha" para receber outro.');
      return;
    }

    let aviso = '';
    try { aviso = sessionStorage.getItem(AVISO) || ''; sessionStorage.removeItem(AVISO); } catch (e) { /* ignore */ }

    if (sessao) { await entrarComSessao(); return; }
    $('tela-auth').hidden = false;
    mostrarTela('login');
    if (aviso) mensagem(aviso, 'ok');
  });
})();
