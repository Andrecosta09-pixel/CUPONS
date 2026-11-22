// =============================================================================
// DASHBOARD.JS — Painel de controle detalhado para compras e buffet (ERIC):
// filtros (período + datas personalizadas, estabelecimento, categoria, busca por
// item), KPIs com comparação, gráfico clicável por dia/mês, itens mais comprados,
// estabelecimentos clicáveis (abre drawer com compras e itens), tabela detalhada
// clicável (abre modal com foto + tabela de itens) e exportação CSV para Excel.
// =============================================================================
(function () {
  const PERIODOS = [
    { id: '7', rotulo: '7 dias', dias: 7 },
    { id: '30', rotulo: '30 dias', dias: 30 },
    { id: '90', rotulo: '90 dias', dias: 90 },
    { id: 'tudo', rotulo: 'Tudo', dias: null },
    { id: 'custom', rotulo: 'Personalizado', dias: null }
  ];
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const dash = {
    periodo: '30',
    dataIni: '',
    dataFim: '',
    estabelecimento: '',
    categoria: '',
    busca: '',
    diaSelecionado: null,
    verDados: false,
    mostrarTodasCompras: false,
    entradas: null,
    ultimoHash: ''
  };

  const ic = (n, x = '') => `<svg class="ic${x}" aria-hidden="true"><use href="/icons.svg#i-${n}"/></svg>`;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reais = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const reaisCurto = (v) => (v >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : 'R$ ' + Math.round(v).toLocaleString('pt-BR'));
  const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : 0);
  const cap = (t) => { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  const dd = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  const dma = (d) => dd(d) + '/' + d.getFullYear();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const iniDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  function parseIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function dataDe(e) {
    return parseIso(e.data_emissao || (e.criado_em || '').slice(0, 10));
  }

  function itensDe(e) {
    const bruto = e && e.dados_brutos_json;
    if (bruto && Array.isArray(bruto.itens) && bruto.itens.length > 0) {
      return bruto.itens.filter((it) => it && it.nome);
    }
    return [];
  }

  function resumoItensTexto(e) {
    const lista = itensDe(e);
    if (lista.length > 0) {
      const nomes = lista.slice(0, 3).map((i) => i.nome).join(', ');
      return lista.length > 3 ? `${nomes} (+${lista.length - 3})` : nomes;
    }
    return e.resumo_itens || '—';
  }

  function agrupar(lista, chave) {
    const mapa = new Map();
    lista.forEach((e) => {
      const k = String(chave(e) || 'Não informado').trim();
      const kk = norm(k);
      const o = mapa.get(kk) || { nome: cap(k), raw: k, total: 0, qtd: 0 };
      o.total += Number(e.valor_total) || 0;
      o.qtd += 1;
      mapa.set(kk, o);
    });
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  }

  function agruparItens(lista) {
    const mapa = new Map();
    let temEstruturado = false;
    lista.forEach((e) => {
      const estruturados = itensDe(e);
      if (estruturados.length > 0) {
        temEstruturado = true;
        estruturados.forEach((it) => {
          const chave = norm(it.nome);
          if (!chave) return;
          const o = mapa.get(chave) || { nome: it.nome.trim(), total: 0, qtd: 0, compras: 0, unidade: it.unidade || 'un' };
          o.total += Number(it.valor_total) || 0;
          o.qtd += Number(it.quantidade) || 1;
          o.compras += 1;
          mapa.set(chave, o);
        });
      } else if (e.resumo_itens) {
        String(e.resumo_itens).split(/[,;]+/).forEach((parte) => {
          const limpo = parte.trim();
          const chave = norm(limpo);
          if (!chave || chave.length < 2) return;
          const o = mapa.get(chave) || { nome: cap(limpo), total: 0, qtd: 0, compras: 0, unidade: '' };
          o.compras += 1;
          mapa.set(chave, o);
        });
      }
    });
    const arr = [...mapa.values()];
    arr.sort((a, b) => (b.total !== a.total ? b.total - a.total : b.compras - a.compras));
    return { lista: arr, temEstruturado };
  }

  const soma = (l) => l.reduce((s, e) => s + (Number(e.valor_total) || 0), 0);

  function aplicaFiltrosExtras(lista) {
    let res = lista;
    if (dash.estabelecimento) {
      const alvo = norm(dash.estabelecimento);
      res = res.filter((e) => norm(e.estabelecimento || 'Não identificado') === alvo);
    }
    if (dash.categoria) {
      const alvo = norm(dash.categoria);
      res = res.filter((e) => norm(e.categoria || 'Outros') === alvo);
    }
    if (dash.busca.trim()) {
      const q = norm(dash.busca);
      res = res.filter((e) => {
        if (norm(e.estabelecimento).includes(q)) return true;
        if (norm(e.categoria).includes(q)) return true;
        if (norm(e.resumo_itens).includes(q)) return true;
        return itensDe(e).some((it) => norm(it.nome).includes(q));
      });
    }
    return res;
  }

  function filtrar(todas) {
    const base = aplicaFiltrosExtras(todas);
    const p = PERIODOS.find((x) => x.id === dash.periodo) || PERIODOS[1];
    const hoje = iniDia(new Date());
    let atual = base, anterior = [];

    if (dash.periodo === 'custom') {
      const ini = parseIso(dash.dataIni) || new Date(hoje.getTime() - 29 * 86400000);
      const fim = parseIso(dash.dataFim) || hoje;
      atual = base.filter((e) => { const d = dataDe(e); return d && d >= ini && d <= fim; });
      return { atual, anterior: [], ini, fim, comparavel: false };
    }

    if (p.dias) {
      const ini = new Date(hoje); ini.setDate(ini.getDate() - (p.dias - 1));
      const iniAnt = new Date(ini); iniAnt.setDate(iniAnt.getDate() - p.dias);
      atual = base.filter((e) => { const d = dataDe(e); return d && d >= ini && d <= hoje; });
      anterior = base.filter((e) => { const d = dataDe(e); return d && d >= iniAnt && d < ini; });
      return { atual, anterior, ini, fim: hoje, comparavel: true };
    }

    const datas = base.map(dataDe).filter(Boolean).sort((a, b) => a - b);
    return { atual, anterior: [], ini: datas[0] || hoje, fim: datas[datas.length - 1] || hoje, comparavel: false };
  }

  function delta(atual, anterior, comparavel) {
    if (!comparavel) return `<span class="kpi__cmp">${dash.periodo === 'custom' ? 'Período selecionado' : 'Todo o histórico'}</span>`;
    if (!anterior) return `<span class="kpi__cmp">Sem período anterior</span>`;
    const v = Math.round(((atual - anterior) / anterior) * 100);
    const ico = v > 0 ? 'trending-up' : (v < 0 ? 'trending-down' : 'arrow-right');
    const sinal = v > 0 ? '+' : '';
    return `<span class="delta">${ic(ico)} ${sinal}${v}%</span><span class="kpi__cmp">vs. período anterior</span>`;
  }

  // ---- Gráfico de barras: gastos ao longo do tempo (clicável por dia/mês) ----
  function serieTempo(atual, ini, fim) {
    const dias = Math.max(1, Math.round((fim - ini) / 86400000) + 1);
    const mensal = dias > 31;
    const baldes = new Map();
    if (!mensal) {
      for (let i = 0; i < dias; i++) {
        const d = new Date(ini); d.setDate(d.getDate() + i);
        const k = d.getTime();
        baldes.set(k, { chave: String(k), rotulo: dd(d), longo: dma(d), total: 0, qtd: 0, itens: [] });
      }
    } else {
      const c = new Date(ini.getFullYear(), ini.getMonth(), 1);
      while (c <= fim) {
        const k = c.getTime();
        baldes.set(k, { chave: String(k), rotulo: `${MESES[c.getMonth()]}/${String(c.getFullYear()).slice(2)}`, longo: `${MESES[c.getMonth()]} de ${c.getFullYear()}`, total: 0, qtd: 0, itens: [] });
        c.setMonth(c.getMonth() + 1);
      }
    }
    atual.forEach((e) => {
      const d = dataDe(e); if (!d) return;
      const chave = mensal ? new Date(d.getFullYear(), d.getMonth(), 1).getTime() : d.getTime();
      const b = baldes.get(chave);
      if (b) { b.total += Number(e.valor_total) || 0; b.qtd += 1; b.itens.push(e); }
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
    if (max === 0) return { titulo: 'Sem gastos neste período', html: vazio('Nenhum comprovante encontrado para os filtros aplicados.'), baldes: [] };
    const topo = escalaBonita(max);
    const iMax = itens.findIndex((i) => i.total === max);
    const passo = itens.length > 16 ? Math.ceil(itens.length / 8) : 1;
    const titulo = `Maior gasto ${mensal ? 'do mês' : 'do dia'}: ${reais(max)} em ${itens[iMax].longo}`;
    const resumo = `${titulo}. Total no período: ${reais(soma(atual))} em ${atual.length} comprovantes.`;

    if (dash.verDados) {
      const linhas = itens.filter((i) => i.qtd > 0).map((i) => `
        <tr class="linha-envio" tabindex="0" role="button" data-dia-chave="${esc(i.chave)}">
          <td>${esc(i.longo)}</td><td>${i.qtd}</td><td class="td-valor">${reais(i.total)}</td>
        </tr>`).join('');
      return { titulo, resumo, baldes: itens, html: `<div class="ds-table-wrapper"><table class="ds-table ds-table--click"><thead><tr><th>${mensal ? 'Mês' : 'Dia'}</th><th>Comprovantes</th><th>Total</th></tr></thead><tbody>${linhas}</tbody></table></div>` };
    }

    const barras = itens.map((i, idx) => {
      const h = i.total > 0 ? Math.max(3, (i.total / topo) * 100) : 0;
      const classe = idx === iMax ? 'bar bar--hl' : (i.total > 0 ? 'bar' : 'bar bar--zero');
      const rot = idx % passo === 0 ? `<span class="bar-lbl">${esc(i.rotulo)}</span>` : '<span class="bar-lbl"></span>';
      const val = idx === iMax ? `<span class="bar-val" style="bottom:${h}%">${reaisCurto(i.total)}</span>` : '';
      const ativo = dash.diaSelecionado === i.chave ? ' bar-col--ativo' : '';
      const clickAttr = i.qtd > 0 ? ` data-dia-chave="${esc(i.chave)}" role="button" tabindex="0"` : '';
      const clickCls = i.qtd > 0 ? ' bar-col--click' : '';
      return `<div class="bar-col${clickCls}${ativo}"${clickAttr} title="${esc(i.longo)} · ${reais(i.total)} · ${i.qtd} comprovante${i.qtd === 1 ? '' : 's'}${i.qtd > 0 ? ' (clique para detalhar)' : ''}">
        <div class="bar-area">${val}<div class="${classe}" style="height:${h}%"></div></div>${rot}</div>`;
    }).join('');

    const baldeAtivo = dash.diaSelecionado ? itens.find((i) => i.chave === dash.diaSelecionado && i.qtd > 0) : null;
    const detalheDia = baldeAtivo ? `
      <div class="dash-dia-detalhe">
        <div class="dash-dia-head">
          <strong>${ic('calendar')} Compras em ${esc(baldeAtivo.longo)} · ${reais(baldeAtivo.total)} (${baldeAtivo.qtd})</strong>
          <button type="button" class="btn btn-ghost btn-sm" id="dash-fechar-dia">Fechar dia</button>
        </div>
        <div class="ds-table-wrapper"><table class="ds-table ds-table--click ds-table--compact">
          <thead><tr><th>Estabelecimento</th><th>Itens comprados</th><th>Valor</th><th><span class="sr-only">Abrir</span></th></tr></thead>
          <tbody>${baldeAtivo.itens.map((e) => `
            <tr class="linha-envio" tabindex="0" role="button" data-abrir-cupom="${esc(e.cupom_id || e.id)}">
              <td class="td-corta">${esc(e.estabelecimento || 'Não identificado')}</td>
              <td class="td-corta" title="${esc(resumoItensTexto(e))}">${esc(resumoItensTexto(e))}</td>
              <td class="td-valor">${reais(e.valor_total)}</td>
              <td>${ic('chevron-right')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : `<div class="ds-card-subtitle" style="margin-top:10px; margin-bottom:0;">Clique em uma barra para ver o que foi comprado naquela data.</div>`;

    const html = `
      <div class="chart" role="img" aria-label="${esc(resumo)}">
        <div class="chart__y"><span>${reaisCurto(topo)}</span><span>${reaisCurto(topo / 2)}</span><span>R$ 0</span></div>
        <div class="chart__plot"><div class="chart__grid"><i></i><i></i><i></i></div><div class="chart__bars">${barras}</div></div>
      </div>${detalheDia}`;
    return { titulo, resumo, html, baldes: itens };
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

  function barrasEstabelecimentos(grupos, total) {
    if (!grupos.length) return vazio('Sem dados neste período.');
    return `<div class="hbars">` + grupos.slice(0, 6).map((g, i) => `
      <button type="button" class="hbar-btn" data-abrir-estab="${esc(g.raw)}" title="Ver compras e itens em ${esc(g.nome)}">
        <div class="hbar-btn__top">
          <span class="hbar__nome">${i + 1}. ${esc(g.nome)}</span>
          <span class="hbar__val">${reais(g.total)} <em>${pct(g.total, total)}%</em></span>
          ${ic('chevron-right')}
        </div>
        <div class="progress-bar-bg"><div class="progress-bar-fill${i === 0 ? '' : ' fill-muted'}" style="width:${pct(g.total, total)}%"></div></div>
        <div class="hbar-btn__sub"><span>${g.qtd} ${g.qtd === 1 ? 'compra' : 'compras'}</span><span>Ticket ${reais(g.total / g.qtd)}</span></div>
      </button>`).join('') + `</div>`;
  }

  function barrasItens(itensInfo) {
    const lista = itensInfo.lista.slice(0, 8);
    if (!lista.length) return vazio('Envie cupons para ver o ranking de insumos mais comprados.');
    const maxVal = itensInfo.temEstruturado ? Math.max(...lista.map((i) => i.total), 1) : Math.max(...lista.map((i) => i.compras), 1);
    return `<div class="hbars">` + lista.map((it, i) => {
      const largura = itensInfo.temEstruturado ? pct(it.total, maxVal) : pct(it.compras, maxVal);
      const valTxt = it.total > 0 ? reais(it.total) : `${it.compras}x`;
      const qtdTxt = it.qtd > 0 && it.unidade ? `${Number(it.qtd).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${esc(it.unidade)} · ` : '';
      return `
      <button type="button" class="hbar-btn" data-buscar-item="${esc(it.nome)}" title="Filtrar compras com ${esc(it.nome)}">
        <div class="hbar-btn__top">
          <span class="hbar__nome">${i + 1}. ${esc(it.nome)}</span>
          <span class="hbar__val">${valTxt}</span>
          ${ic('chevron-right')}
        </div>
        <div class="progress-bar-bg"><div class="progress-bar-fill${i === 0 ? '' : ' fill-muted'}" style="width:${largura}%"></div></div>
        <div class="hbar-btn__sub"><span>${qtdTxt}${it.compras} ${it.compras === 1 ? 'compra' : 'compras'}</span><span>Clique para filtrar</span></div>
      </button>`;
    }).join('') + `</div>`;
  }

  function cartao(titulo, corpo, extra = '') {
    return `<section class="ds-card dash-card ${extra}"><h3 class="ds-card-title dash-titulo">${esc(titulo)}</h3>${corpo}</section>`;
  }

  // ---- Drawer detalhado por estabelecimento ----
  function abrirDrawerEstabelecimento(nomeEstab) {
    const f = filtrar(dash.entradas || []);
    const alvo = norm(nomeEstab);
    const compras = f.atual
      .filter((e) => norm(e.estabelecimento || 'Não identificado') === alvo)
      .sort((a, b) => (b.data_emissao || b.criado_em || '').localeCompare(a.data_emissao || a.criado_em || ''));

    const drawer = document.getElementById('drawer-envio');
    const veu = document.getElementById('drawer-veu');
    if (!drawer || !veu) return;

    const total = soma(compras);
    const ticket = compras.length ? total / compras.length : 0;

    document.getElementById('drawer-kicker').textContent = 'Detalhamento por estabelecimento';
    document.getElementById('drawer-titulo').textContent = compras[0]?.estabelecimento || nomeEstab;
    const sit = document.getElementById('drawer-situacao');
    sit.className = 'badge badge-neutro';
    sit.textContent = `${compras.length} ${compras.length === 1 ? 'compra' : 'compras'}`;

    const comprasHtml = compras.map((c) => {
      const d = dataDe(c);
      const itens = itensDe(c);
      const blocoItens = itens.length > 0 ? `
        <div class="ds-table-wrapper"><table class="ds-table ds-table--compact">
          <thead><tr><th>Item</th><th>Qtd</th><th>Total</th></tr></thead>
          <tbody>${itens.map((it) => `
            <tr>
              <td class="td-corta" title="${esc(it.nome)}">${esc(it.nome)}</td>
              <td>${Number(it.quantidade || 1).toLocaleString('pt-BR')} ${esc(it.unidade || 'un')}</td>
              <td class="td-valor">${reais(it.valor_total)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : `<div class="dr-compra__resumo">${esc(c.resumo_itens || 'Nenhum item discriminado neste comprovante.')}</div>`;

      return `
        <article class="dr-compra">
          <div class="dr-compra__head">
            <div>
              <div class="dr-compra__data">${d ? dma(d) : 'Sem data'}</div>
              <div class="dr-compra__meta">${esc(cap(c.categoria || 'Outros'))} · ${esc(cap(c.forma_pagamento || 'Outros'))}</div>
            </div>
            <div class="dr-compra__val">${reais(c.valor_total)}</div>
          </div>
          ${blocoItens}
          <div class="dr-compra__foot">
            <button type="button" class="btn btn-secondary btn-sm" data-drawer-cupom="${esc(c.cupom_id || c.id)}">${ic('eye')} Ver comprovante</button>
          </div>
        </article>`;
    }).join('');

    const corpo = document.getElementById('drawer-corpo');
    corpo.innerHTML = `
      <div class="dr-resumo-grid">
        <div class="dr-resumo-box"><small>Total gasto</small><strong>${reais(total)}</strong></div>
        <div class="dr-resumo-box"><small>Compras</small><strong>${compras.length}</strong></div>
        <div class="dr-resumo-box"><small>Ticket médio</small><strong>${reais(ticket)}</strong></div>
      </div>
      ${comprasHtml || vazio('Nenhuma compra encontrada neste período.')}`;

    corpo.querySelectorAll('[data-drawer-cupom]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof window.verComprovanteOriginal === 'function') {
          window.verComprovanteOriginal(btn.dataset.drawerCupom);
        }
      });
    });

    const rodape = document.getElementById('drawer-rodape');
    rodape.innerHTML = `
      <button type="button" class="btn btn-primary btn-sm" id="dr-btn-filtrar-estab">${ic('store')} Filtrar no dashboard</button>
      <button type="button" class="btn btn-secondary btn-sm" id="dr-btn-fechar-estab">Fechar</button>`;

    const fechar = () => { drawer.hidden = true; veu.hidden = true; };
    document.getElementById('dr-btn-fechar-estab').addEventListener('click', fechar);
    document.getElementById('dr-btn-filtrar-estab').addEventListener('click', () => {
      dash.estabelecimento = compras[0]?.estabelecimento || nomeEstab;
      fechar();
      render();
    });

    drawer.hidden = false;
    veu.hidden = false;
    document.getElementById('drawer-fechar')?.focus();
  }

  // ---- Exportar CSV (100% local no navegador, pronto para Excel PT-BR) ----
  function exportarCsv(lista) {
    if (!lista || !lista.length) {
      if (typeof window.toast === 'function') window.toast('Não há compras filtradas para exportar.', 'info');
      return;
    }
    const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const numBr = (v) => (v != null && v !== '' && !isNaN(Number(v))) ? Number(v).toFixed(2).replace('.', ',') : '';
    const linhas = [
      ['Data', 'Estabelecimento', 'Categoria', 'Forma de Pagamento', 'Item', 'Quantidade', 'Unidade', 'Valor Unitario (R$)', 'Valor do Item (R$)', 'Total do Cupom (R$)', 'Status'].map(cel).join(';')
    ];

    lista.forEach((e) => {
      const d = dataDe(e);
      const dataStr = d ? dma(d) : '';
      const estab = e.estabelecimento || 'Não identificado';
      const cat = cap(e.categoria || 'Outros');
      const pag = cap(e.forma_pagamento || 'Outros');
      const totCupom = numBr(e.valor_total);
      const st = cap(e.status_revisao || 'novo');
      const itens = itensDe(e);

      if (itens.length > 0) {
        itens.forEach((it) => {
          linhas.push([
            dataStr, estab, cat, pag,
            it.nome,
            String(it.quantidade ?? 1).replace('.', ','),
            it.unidade || 'un',
            numBr(it.valor_unitario),
            numBr(it.valor_total),
            totCupom, st
          ].map(cel).join(';'));
        });
      } else {
        linhas.push([
          dataStr, estab, cat, pag,
          e.resumo_itens || 'Sem detalhamento de itens',
          '', '', '', totCupom, totCupom, st
        ].map(cel).join(';'));
      }
    });

    const blob = new Blob(['\uFEFF' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cupomfacil-compras-${iso(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (typeof window.toast === 'function') window.toast('Planilha CSV exportada com sucesso.');
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
    const totalItensLidos = atual.reduce((acc, e) => acc + itensDe(e).length, 0);

    const periodoBtns = PERIODOS.map((p) => `<button type="button" class="seg__opt" data-periodo="${p.id}" aria-pressed="${dash.periodo === p.id}">${p.rotulo}</button>`).join('');

    // Opções únicas de estabelecimentos e categorias (do histórico todo)
    const todosEstabs = [...new Map(todas.map((e) => [norm(e.estabelecimento || 'Não identificado'), e.estabelecimento || 'Não identificado'])).values()].sort((a, b) => a.localeCompare(b));
    const todasCats = [...new Map(todas.map((e) => [norm(e.categoria || 'Outros'), cap(e.categoria || 'Outros')])).values()].sort((a, b) => a.localeCompare(b));

    const temFiltroAtivo = Boolean(dash.estabelecimento || dash.categoria || dash.busca.trim() || dash.periodo === 'custom');

    const kpi = (icone, rotulo, valor, rodape) => `
      <div class="ds-card kpi-card">
        <div class="kpi-card__top"><span class="kpi-card__ico">${ic(icone)}</span><span class="ds-card-subtitle" style="margin:0;">${rotulo}</span></div>
        <div class="kpi">${valor}</div>
        <div class="kpi-card__foot">${rodape}</div>
      </div>`;

    const g = graficoTempo(atual, f.ini, f.fim);
    const porCat = agrupar(atual, (e) => e.categoria || 'Outros');
    const porPag = agrupar(atual, (e) => e.forma_pagamento || 'Outros');
    const porEst = agrupar(atual, (e) => e.estabelecimento || 'Não identificado');
    const itensInfo = agruparItens(atual);

    const tituloCat = porCat.length ? `${porCat[0].nome} concentra ${pct(porCat[0].total, total)}% dos gastos` : 'Gastos por categoria';
    const tituloPag = porPag.length ? `${porPag[0].nome} é a forma mais usada (${pct(porPag[0].total, total)}%)` : 'Forma de pagamento';
    const tituloEst = porEst.length ? `Estabelecimentos: ${porEst[0].nome} lidera` : 'Estabelecimentos';
    const tituloItens = itensInfo.lista.length
      ? (itensInfo.temEstruturado ? `Insumo líder: ${itensInfo.lista[0].nome} (${reais(itensInfo.lista[0].total)})` : `Item mais recorrente: ${itensInfo.lista[0].nome}`)
      : 'Itens mais comprados';

    const ordenados = [...atual].sort((a, b) => (b.data_emissao || b.criado_em || '').localeCompare(a.data_emissao || a.criado_em || ''));
    const limiteTabela = dash.mostrarTodasCompras ? ordenados.length : 15;
    const visiveis = ordenados.slice(0, limiteTabela);

    const ultHtml = visiveis.length ? `
      <div class="ds-table-wrapper"><table class="ds-table ds-table--click">
        <thead><tr><th>Data</th><th>Estabelecimento</th><th>Itens comprados</th><th>Categoria</th><th>Valor</th><th>Status</th><th><span class="sr-only">Abrir</span></th></tr></thead>
        <tbody>
        ${visiveis.map((e) => {
          const d = dataDe(e); const st = e.status_revisao || 'novo';
          const cls = st === 'confirmado' ? 'badge-confirmado' : (st === 'revisar' ? 'badge-revisar' : 'badge-novo');
          const resumo = resumoItensTexto(e);
          return `<tr class="linha-envio" tabindex="0" role="button" data-abrir-cupom="${esc(e.cupom_id || e.id)}">
            <td>${d ? dma(d) : '—'}</td>
            <td class="td-corta" title="${esc(e.estabelecimento || 'Não identificado')}">${esc(e.estabelecimento || 'Não identificado')}</td>
            <td class="td-corta" title="${esc(resumo)}">${esc(resumo)}</td>
            <td><span class="badge badge-neutro">${esc(cap(e.categoria || 'Outros'))}</span></td>
            <td class="td-valor">${reais(e.valor_total)}</td>
            <td><span class="badge ${cls}">${cap(st)}</span></td>
            <td>${ic('chevron-right')}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>` : vazio('Nenhuma compra encontrada para os filtros selecionados.');

    const semDados = !dash.entradas || dash.entradas.length === 0;
    const hojeIso = iso(new Date());
    const iniPadrao = dash.dataIni || iso(new Date(Date.now() - 29 * 86400000));
    const fimPadrao = dash.dataFim || hojeIso;

    raiz.innerHTML = `
      <div class="dash-head">
        <div>
          <div class="ds-card-subtitle" style="margin:0;">Visão geral</div>
          <h2 class="dash-h1">Dashboard de Compras</h2>
          <p class="ds-card-subtitle">Detalhamento por estabelecimento, data e itens comprados${f.ini && f.fim && !semDados ? ` · ${dma(f.ini)} a ${dma(f.fim)}` : ''}</p>
        </div>
        <div class="dash-filtros">
          <div class="seg" role="group" aria-label="Período">${periodoBtns}</div>
        </div>
      </div>

      ${semDados ? `<div class="ds-card">${vazio('Ainda não há comprovantes lidos. Envie o primeiro na aba Novo Envio.')}</div>` : `
      <div class="dash-bar-filtros" role="search" aria-label="Filtros do dashboard">
        ${dash.periodo === 'custom' ? `
        <div class="dash-datas">
          <span>De</span>
          <input type="date" id="dash-data-ini" class="ds-input" value="${esc(iniPadrao)}" aria-label="Data inicial">
          <span>até</span>
          <input type="date" id="dash-data-fim" class="ds-input" value="${esc(fimPadrao)}" aria-label="Data final">
        </div>` : ''}
        <input type="search" id="dash-busca" class="ds-input dash-busca" value="${esc(dash.busca)}" placeholder="Buscar item (ex: mussarela, frango) ou mercado…" aria-label="Buscar por item ou estabelecimento">
        <select id="dash-filtro-estab" class="ds-select" aria-label="Filtrar por estabelecimento">
          <option value="">Todos os estabelecimentos</option>
          ${todosEstabs.map((n) => `<option value="${esc(n)}"${norm(dash.estabelecimento) === norm(n) ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <select id="dash-filtro-cat" class="ds-select" aria-label="Filtrar por categoria">
          <option value="">Todas as categorias</option>
          ${todasCats.map((n) => `<option value="${esc(n)}"${norm(dash.categoria) === norm(n) ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <div class="dash-bar-acoes">
          ${temFiltroAtivo ? `<button type="button" class="btn btn-ghost btn-sm" id="dash-limpar-filtros">Limpar filtros</button>` : ''}
          <button type="button" class="btn btn-secondary btn-sm" id="dash-exportar-csv">${ic('download')} Exportar CSV</button>
        </div>
      </div>

      <div class="kpi-grid">
        ${kpi('wallet', 'Total registrado', reais(total), delta(total, totalAnt, f.comparavel))}
        ${kpi('receipt-text', 'Comprovantes', String(qtd), totalItensLidos > 0 ? `<span class="kpi__cmp">${totalItensLidos} itens discriminados</span>` : delta(qtd, qtdAnt, f.comparavel))}
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
        ${cartao(tituloEst, `<p class="ds-card-subtitle" style="margin-top:-6px; margin-bottom:12px;">Clique em um estabelecimento para ver as compras e itens</p>` + barrasEstabelecimentos(porEst, total))}
      </div>

      <div class="dash-linha dash-linha--3">
        ${cartao(tituloItens, `<p class="ds-card-subtitle" style="margin-top:-6px; margin-bottom:12px;">Ranking de insumos do período</p>` + barrasItens(itensInfo))}
        ${cartao(tituloCat, barrasHorizontais(porCat, total))}
        ${cartao(tituloPag, barrasHorizontais(porPag, total))}
      </div>

      <section class="ds-card dash-card">
        <div class="ds-card-header" style="margin-bottom:12px;">
          <div>
            <h3 class="ds-card-title dash-titulo">Compras detalhadas (${ordenados.length})</h3>
            <p class="ds-card-subtitle" style="margin:2px 0 0;">Clique em qualquer compra para abrir a lista completa de itens e a foto do cupom</p>
          </div>
          ${ordenados.length > 15 ? `<button type="button" class="btn btn-secondary btn-sm" id="dash-toggle-todas">${dash.mostrarTodasCompras ? 'Mostrar menos' : `Ver todas (${ordenados.length})`}</button>` : ''}
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
      if (p) {
        dash.periodo = p.dataset.periodo;
        dash.diaSelecionado = null;
        if (dash.periodo === 'custom' && !dash.dataIni) {
          dash.dataIni = iso(new Date(Date.now() - 29 * 86400000));
          dash.dataFim = iso(new Date());
        }
        render();
        raiz.querySelector(`[data-periodo="${dash.periodo}"]`)?.focus();
        return;
      }
      if (ev.target.closest('#dash-ver-dados')) {
        dash.verDados = !dash.verDados;
        render();
        raiz.querySelector('#dash-ver-dados')?.focus();
        return;
      }
      if (ev.target.closest('#dash-fechar-dia')) {
        dash.diaSelecionado = null;
        render();
        return;
      }
      if (ev.target.closest('#dash-limpar-filtros')) {
        dash.estabelecimento = '';
        dash.categoria = '';
        dash.busca = '';
        dash.diaSelecionado = null;
        if (dash.periodo === 'custom') dash.periodo = '30';
        render();
        return;
      }
      if (ev.target.closest('#dash-exportar-csv')) {
        const f = filtrar(dash.entradas || []);
        exportarCsv(f.atual);
        return;
      }
      if (ev.target.closest('#dash-toggle-todas')) {
        dash.mostrarTodasCompras = !dash.mostrarTodasCompras;
        render();
        return;
      }
      if (ev.target.closest('#dash-ir-revisar')) {
        document.querySelector('[data-tab="tab-novas-entradas"]')?.click();
        return;
      }
      const btnEst = ev.target.closest('[data-abrir-estab]');
      if (btnEst) {
        abrirDrawerEstabelecimento(btnEst.dataset.abrirEstab);
        return;
      }
      const btnItem = ev.target.closest('[data-buscar-item]');
      if (btnItem) {
        dash.busca = btnItem.dataset.buscarItem;
        render();
        return;
      }
      const btnCupom = ev.target.closest('[data-abrir-cupom]');
      if (btnCupom && typeof window.verComprovanteOriginal === 'function') {
        window.verComprovanteOriginal(btnCupom.dataset.abrirCupom);
        return;
      }
      const colDia = ev.target.closest('[data-dia-chave]');
      if (colDia) {
        const k = colDia.dataset.diaChave;
        dash.diaSelecionado = dash.diaSelecionado === k ? null : k;
        render();
        return;
      }
    });

    raiz.addEventListener('change', (ev) => {
      if (ev.target.id === 'dash-filtro-estab') { dash.estabelecimento = ev.target.value; dash.diaSelecionado = null; render(); }
      if (ev.target.id === 'dash-filtro-cat') { dash.categoria = ev.target.value; dash.diaSelecionado = null; render(); }
      if (ev.target.id === 'dash-data-ini') { dash.dataIni = ev.target.value; dash.diaSelecionado = null; render(); }
      if (ev.target.id === 'dash-data-fim') { dash.dataFim = ev.target.value; dash.diaSelecionado = null; render(); }
    });

    raiz.addEventListener('input', (ev) => {
      if (ev.target.id === 'dash-busca') {
        const pos = ev.target.selectionStart;
        dash.busca = ev.target.value;
        dash.diaSelecionado = null;
        render();
        const inp = document.getElementById('dash-busca');
        if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (_) {} }
      }
    });

    raiz.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const alvo = ev.target.closest('[data-abrir-cupom], [data-dia-chave]');
      if (alvo) { ev.preventDefault(); alvo.click(); }
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
