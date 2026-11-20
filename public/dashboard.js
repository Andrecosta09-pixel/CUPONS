// =============================================================================
// DASHBOARD.JS — Painel de controle (ERIC): filtros, KPIs com comparação,
// gastos por período, categorias, clientes, pagamento, top estabelecimentos,
// qualidade da leitura e últimos lançamentos.
// Tudo é calculado no navegador a partir de /api/novas-entradas.
// Gráficos: título = conclusão, eixo em 0, destaque em 1 série, "Ver dados".
// =============================================================================
(function () {
  const PERIODOS = [
    { id: '7', rotulo: '7 dias', dias: 7 },
    { id: '30', rotulo: '30 dias', dias: 30 },
    { id: '90', rotulo: '90 dias', dias: 90 },
    { id: 'tudo', rotulo: 'Tudo', dias: null }
  ];
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const dash = { periodo: '30', cliente: '', verDados: false, entradas: null, ultimoHash: '' };

  const ic = (n, x = '') => `<svg class="ic${x}" aria-hidden="true"><use href="/icons.svg#i-${n}"/></svg>`;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reais = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const reaisCurto = (v) => (v >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : 'R$ ' + Math.round(v).toLocaleString('pt-BR'));
  const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : 0);
  const cap = (t) => { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  const dd = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  const dma = (d) => dd(d) + '/' + d.getFullYear();
  const iniDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function dataDe(e) {
    const s = e.data_emissao || (e.criado_em || '').slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function agrupar(lista, chave) {
    const mapa = new Map();
    lista.forEach((e) => {
      const k = String(chave(e) || 'Não informado').trim();
      const kk = k.toLowerCase();
      const o = mapa.get(kk) || { nome: cap(k), total: 0, qtd: 0 };
      o.total += Number(e.valor_total) || 0;
      o.qtd += 1;
      mapa.set(kk, o);
    });
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  }

  const soma = (l) => l.reduce((s, e) => s + (Number(e.valor_total) || 0), 0);

  function filtrar(todas) {
    const p = PERIODOS.find((x) => x.id === dash.periodo);
    const hoje = iniDia(new Date());
    let atual = todas, anterior = [];
    if (p.dias) {
      const ini = new Date(hoje); ini.setDate(ini.getDate() - (p.dias - 1));
      const iniAnt = new Date(ini); iniAnt.setDate(iniAnt.getDate() - p.dias);
      atual = todas.filter((e) => { const d = dataDe(e); return d && d >= ini && d <= hoje; });
      anterior = todas.filter((e) => { const d = dataDe(e); return d && d >= iniAnt && d < ini; });
      return { atual, anterior, ini, fim: hoje, comparavel: true };
    }
    const datas = todas.map(dataDe).filter(Boolean).sort((a, b) => a - b);
    return { atual, anterior, ini: datas[0] || hoje, fim: datas[datas.length - 1] || hoje, comparavel: false };
  }

  function delta(atual, anterior, comparavel) {
    if (!comparavel) return `<span class="kpi__cmp">Todo o histórico</span>`;
    if (!anterior) return `<span class="kpi__cmp">Sem período anterior</span>`;
    const v = Math.round(((atual - anterior) / anterior) * 100);
    const ico = v > 0 ? 'trending-up' : (v < 0 ? 'trending-down' : 'arrow-right');
    const sinal = v > 0 ? '+' : '';
    return `<span class="delta">${ic(ico)} ${sinal}${v}%</span><span class="kpi__cmp">vs. período anterior</span>`;
  }

  // ---- Gráfico de barras: gastos ao longo do tempo ----
  function serieTempo(atual, ini, fim) {
    const dias = Math.round((fim - ini) / 86400000) + 1;
    const mensal = dias > 31;
    const baldes = new Map();
    if (!mensal) {
      for (let i = 0; i < dias; i++) {
        const d = new Date(ini); d.setDate(d.getDate() + i);
        baldes.set(d.getTime(), { rotulo: dd(d), longo: dma(d), total: 0, qtd: 0 });
      }
    } else {
      const c = new Date(ini.getFullYear(), ini.getMonth(), 1);
      while (c <= fim) {
        baldes.set(c.getTime(), { rotulo: `${MESES[c.getMonth()]}/${String(c.getFullYear()).slice(2)}`, longo: `${MESES[c.getMonth()]} de ${c.getFullYear()}`, total: 0, qtd: 0 });
        c.setMonth(c.getMonth() + 1);
      }
    }
    atual.forEach((e) => {
      const d = dataDe(e); if (!d) return;
      const chave = mensal ? new Date(d.getFullYear(), d.getMonth(), 1).getTime() : d.getTime();
      const b = baldes.get(chave); if (b) { b.total += Number(e.valor_total) || 0; b.qtd += 1; }
    });
    return { itens: [...baldes.values()], mensal };
  }

  function escalaBonita(max) {
    if (max <= 0) return 10;
    const exp = Math.pow(10, Math.floor(Math.log10(max)));
    const f = max / exp;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
  }

  function graficoTempo(atual, ini, fim) {
    const { itens, mensal } = serieTempo(atual, ini, fim);
    const max = Math.max(...itens.map((i) => i.total), 0);
    if (max === 0) return { titulo: 'Sem gastos neste período', html: vazio('Nenhum comprovante com data neste período.') };
    const topo = escalaBonita(max);
    const iMax = itens.findIndex((i) => i.total === max);
    const passo = itens.length > 16 ? Math.ceil(itens.length / 8) : 1;
    const titulo = `Maior gasto ${mensal ? 'do mês' : 'do dia'}: ${reais(max)} em ${itens[iMax].longo}`;
    const resumo = `${titulo}. Total no período: ${reais(soma(atual))} em ${atual.length} comprovantes.`;

    if (dash.verDados) {
      const linhas = itens.filter((i) => i.qtd > 0).map((i) => `<tr><td>${esc(i.longo)}</td><td>${i.qtd}</td><td class="td-valor">${reais(i.total)}</td></tr>`).join('');
      return { titulo, resumo, html: `<div class="ds-table-wrapper"><table class="ds-table"><thead><tr><th>${mensal ? 'Mês' : 'Dia'}</th><th>Comprovantes</th><th>Total</th></tr></thead><tbody>${linhas}</tbody></table></div>` };
    }

    const barras = itens.map((i, idx) => {
      const h = i.total > 0 ? Math.max(3, (i.total / topo) * 100) : 0;
      const classe = idx === iMax ? 'bar bar--hl' : (i.total > 0 ? 'bar' : 'bar bar--zero');
      const rot = idx % passo === 0 ? `<span class="bar-lbl">${esc(i.rotulo)}</span>` : '<span class="bar-lbl"></span>';
      const val = idx === iMax ? `<span class="bar-val" style="bottom:${h}%">${reaisCurto(i.total)}</span>` : '';
      return `<div class="bar-col" title="${esc(i.longo)} · ${reais(i.total)} · ${i.qtd} comprovante${i.qtd === 1 ? '' : 's'}">
        <div class="bar-area">${val}<div class="${classe}" style="height:${h}%"></div></div>${rot}</div>`;
    }).join('');
    const html = `
      <div class="chart" role="img" aria-label="${esc(resumo)}">
        <div class="chart__y"><span>${reaisCurto(topo)}</span><span>${reaisCurto(topo / 2)}</span><span>R$ 0</span></div>
        <div class="chart__plot"><div class="chart__grid"><i></i><i></i><i></i></div><div class="chart__bars">${barras}</div></div>
      </div>`;
    return { titulo, resumo, html };
  }

  const vazio = (txt) => `<div class="empty-state" style="padding:24px 8px;"><div class="empty-state-text" style="margin:0;">${esc(txt)}</div></div>`;

  function barrasHorizontais(grupos, total, limite = 6) {
    if (!grupos.length) return vazio('Sem dados neste período.');
    return `<div class="hbars">` + grupos.slice(0, limite).map((g, i) => `
      <div class="hbar">
        <div class="hbar__top"><span class="hbar__nome" title="${esc(g.nome)}">${esc(g.nome)}</span>
          <span class="hbar__val">${reais(g.total)} <em>${pct(g.total, total)}%</em></span></div>
        <div class="progress-bar-bg"><div class="progress-bar-fill${i === 0 ? '' : ' fill-muted'}" style="width:${pct(g.total, total)}%"></div></div>
      </div>`).join('') + `</div>`;
  }

  function cartao(titulo, corpo, extra = '') {
    return `<section class="ds-card dash-card ${extra}"><h3 class="ds-card-title dash-titulo">${esc(titulo)}</h3>${corpo}</section>`;
  }

  function render() {
    const raiz = document.getElementById('dash-root');
    if (!raiz) return;
    const todas = dash.entradas || [];
    const f = filtrar(todas);
    const atual = f.atual;
    const total = soma(atual), qtd = atual.length;
    const ticket = qtd ? total / qtd : 0;
    const totalAnt = soma(f.anterior), qtdAnt = f.anterior.length;
    const ticketAnt = qtdAnt ? totalAnt / qtdAnt : 0;
    const pendentes = atual.filter((e) => e.status_revisao !== 'confirmado').length;

    const periodoBtns = PERIODOS.map((p) => `<button type="button" class="seg__opt" data-periodo="${p.id}" aria-pressed="${dash.periodo === p.id}">${p.rotulo}</button>`).join('');

    const kpi = (icone, rotulo, valor, rodape) => `
      <div class="ds-card kpi-card">
        <div class="kpi-card__top"><span class="kpi-card__ico">${ic(icone)}</span><span class="ds-card-subtitle" style="margin:0;">${rotulo}</span></div>
        <div class="kpi">${valor}</div>
        <div class="kpi-card__foot">${rodape}</div>
      </div>`;

    const g = graficoTempo(atual, f.ini, f.fim);
    const porCat = agrupar(atual, (e) => e.categoria || 'Outros');
    const maiores = [...atual].sort((a, b) => (Number(b.valor_total) || 0) - (Number(a.valor_total) || 0)).slice(0, 3);
    const porPag = agrupar(atual, (e) => e.forma_pagamento || 'Outros');
    const porEst = agrupar(atual, (e) => e.estabelecimento || 'Não identificado');

    const tituloCat = porCat.length ? `${porCat[0].nome} concentra ${pct(porCat[0].total, total)}% dos gastos` : 'Gastos por categoria';
    const tituloMaiores = maiores.length ? `Maior compra: ${reais(maiores[0].valor_total)} em ${maiores[0].estabelecimento || 'estabelecimento não identificado'}` : 'Maiores compras';
    const maioresHtml = maiores.length ? `<div class="hbars">` + maiores.map((e, i) => {
      const d = dataDe(e);
      return `<div class="hbar"><div class="hbar__top"><span class="hbar__nome" title="${esc(e.estabelecimento || '')}">${i + 1}. ${esc(e.estabelecimento || 'Não identificado')}</span><span class="hbar__val">${reais(e.valor_total)}</span></div><div class="ds-card-subtitle" style="margin:0;">${d ? dma(d) : 'Sem data'} · ${esc(cap(e.categoria || 'Outros'))}</div></div>`;
    }).join('') + `</div>` : vazio('Sem dados neste período.');
    const tituloPag = porPag.length ? `${porPag[0].nome} é a forma mais usada (${pct(porPag[0].total, total)}%)` : 'Forma de pagamento';

    const conf = { alta: 0, media: 0, baixa: 0 };
    atual.forEach((e) => { const k = e.confianca || 'alta'; conf[k] = (conf[k] || 0) + 1; });
    const tituloConf = qtd ? `${pct(conf.alta, qtd)}% dos comprovantes foram lidos com confiança alta` : 'Qualidade da leitura';
    const confHtml = qtd ? `
      <div class="stack" role="img" aria-label="${esc(tituloConf)}">
        <i class="stack__a" style="flex:${conf.alta}"></i><i class="stack__m" style="flex:${conf.media}"></i><i class="stack__b" style="flex:${conf.baixa}"></i>
      </div>
      <ul class="legenda">
        <li><span class="badge badge-alta">Alta</span> ${conf.alta}</li>
        <li><span class="badge badge-media">Média</span> ${conf.media}</li>
        <li><span class="badge badge-baixa">Baixa</span> ${conf.baixa}</li>
      </ul>` : vazio('Sem dados neste período.');

    const topEst = barrasHorizontais(porEst.slice(0, 5).map((e, i) => ({ ...e, nome: `${i + 1}. ${e.nome}` })), total, 5);

    const ultimos = [...atual].sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || '')).slice(0, 5);
    const ultHtml = ultimos.length ? `
      <div class="ds-table-wrapper"><table class="ds-table"><thead><tr><th>Data</th><th>Estabelecimento</th><th>Categoria</th><th>Valor</th><th>Status</th></tr></thead><tbody>
      ${ultimos.map((e) => {
        const d = dataDe(e); const st = e.status_revisao || 'novo';
        const cls = st === 'confirmado' ? 'badge-confirmado' : (st === 'revisar' ? 'badge-revisar' : 'badge-novo');
        return `<tr><td>${d ? dma(d) : '—'}</td><td class="td-corta">${esc(e.estabelecimento || 'Não identificado')}</td><td><span class="badge badge-neutro">${esc(cap(e.categoria || 'Outros'))}</span></td><td class="td-valor">${reais(e.valor_total)}</td><td><span class="badge ${cls}">${cap(st)}</span></td></tr>`;
      }).join('')}
      </tbody></table></div>` : vazio('Sem lançamentos neste período.');

    const semDados = !dash.entradas || dash.entradas.length === 0;
    raiz.innerHTML = `
      <div class="dash-head">
        <div>
          <div class="ds-card-subtitle" style="margin:0;">Visão geral</div>
          <h2 class="dash-h1">Dashboard</h2>
          <p class="ds-card-subtitle">Resumo dos comprovantes lidos pela IA${f.comparavel ? ` · ${dma(f.ini)} a ${dma(f.fim)}` : ''}</p>
        </div>
        <div class="dash-filtros">
          <div class="seg" role="group" aria-label="Período">${periodoBtns}</div>
        </div>
      </div>

      ${semDados ? `<div class="ds-card">${vazio('Ainda não há comprovantes lidos. Envie o primeiro na aba Novo Envio.')}</div>` : `
      <div class="kpi-grid">
        ${kpi('wallet', 'Total registrado', reais(total), delta(total, totalAnt, f.comparavel))}
        ${kpi('receipt-text', 'Comprovantes', String(qtd), delta(qtd, qtdAnt, f.comparavel))}
        ${kpi('calculator', 'Ticket médio', reais(ticket), delta(ticket, ticketAnt, f.comparavel))}
        ${kpi('clipboard-list', 'Pendentes de revisão', String(pendentes), pendentes ? `<button type="button" class="link-acao" id="dash-ir-revisar">Revisar agora ${ic('arrow-right')}</button>` : '<span class="kpi__cmp">Tudo conferido</span>')}
      </div>

      <div class="dash-linha dash-linha--2-1">
        <section class="ds-card dash-card">
          <div class="ds-card-header" style="margin-bottom:12px;">
            <h3 class="ds-card-title dash-titulo">${esc(g.titulo)}</h3>
            <button type="button" class="btn btn-secondary btn-sm" id="dash-ver-dados" aria-pressed="${dash.verDados}">${ic(dash.verDados ? 'chart-column' : 'table-2')} ${dash.verDados ? 'Ver gráfico' : 'Ver dados'}</button>
          </div>
          ${g.html}
        </section>
        <div class="dash-col">
          ${cartao(tituloMaiores, maioresHtml)}
          ${cartao(tituloConf, confHtml)}
        </div>
      </div>

      <div class="dash-linha dash-linha--3">
        ${cartao(tituloCat, barrasHorizontais(porCat, total))}
        ${cartao(tituloPag, barrasHorizontais(porPag, total))}
        ${cartao(porEst.length ? `Top estabelecimentos: ${porEst[0].nome} lidera` : 'Top estabelecimentos', topEst)}
      </div>

      <section class="ds-card dash-card">
        <div class="ds-card-header" style="margin-bottom:12px;">
          <h3 class="ds-card-title dash-titulo">Últimos lançamentos</h3>
          <button type="button" class="btn btn-secondary btn-sm" id="dash-ver-todos">Ver todos ${ic('arrow-right')}</button>
        </div>
        ${ultHtml}
      </section>`}`;
  }

  function ligar() {
    const raiz = document.getElementById('dash-root');
    if (!raiz || raiz.dataset.ligado) return;
    raiz.dataset.ligado = '1';
    raiz.addEventListener('click', (ev) => {
      const p = ev.target.closest('[data-periodo]');
      if (p) { dash.periodo = p.dataset.periodo; render(); raiz.querySelector(`[data-periodo="${dash.periodo}"]`)?.focus(); return; }
      if (ev.target.closest('#dash-ver-dados')) { dash.verDados = !dash.verDados; render(); raiz.querySelector('#dash-ver-dados')?.focus(); return; }
      if (ev.target.closest('#dash-ir-revisar') || ev.target.closest('#dash-ver-todos')) {
        document.querySelector('[data-tab="tab-novas-entradas"]')?.click();
      }
    });
  }

  window.carregarDashboard = async function () {
    const raiz = document.getElementById('dash-root');
    if (!raiz) return;
    ligar();
    try {
      const res = await fetch('/api/novas-entradas');
      if (!res.ok) throw new Error('falha');
      const dados = await res.json();
      const hash = JSON.stringify(dados);
      // Evita redesenhar (e perder o foco) quando nada mudou
      if (hash === dash.ultimoHash && raiz.children.length) return;
      dash.ultimoHash = hash;
      dash.entradas = Array.isArray(dados) ? dados : [];
      render();
    } catch (e) {
      console.error('Erro dashboard:', e);
      if (!raiz.children.length) raiz.innerHTML = `<div class="ds-card">${vazio('Não foi possível carregar o dashboard. Tente de novo em instantes.')}</div>`;
    }
  };
})();
