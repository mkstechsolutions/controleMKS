const URL_API = "https://script.google.com/macros/s/AKfycbzS_fuG0LNhfvMPdr5WKGK57ULvf8_xaAoAMgxeoLmcoMondkP2-zcc22Bv_Us5WCr5ww/exec";
let DADOS_GLOBAIS = { estoque: [], financeiro: [] };
let meuGrafico = null;
let timerInatividade; 

// --- LÓGICA DE INATIVIDADE (Ajustado para 15 minutos) ---
function resetarTimer() {
    clearTimeout(timerInatividade);
    // 15 minutos = 15 * 60 * 1000 ms
    const tempoLimite = 15 * 60 * 1000; 
    timerInatividade = setTimeout(() => {
        logoutInatividade();
    }, tempoLimite);
}

function logoutInatividade() {
    localStorage.removeItem('mks_autenticado');
    const loginOverlay = document.getElementById('login-overlay');
    if (loginOverlay) {
        loginOverlay.style.display = 'flex';
        const msg = document.getElementById('msg-login');
        if (msg) {
            msg.innerText = "Sessão expirada por inatividade (15 min).";
            msg.style.color = "orange";
        }
    }
}

function iniciarMonitoramento() {
    const eventos = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    eventos.forEach(evento => {
        document.addEventListener(evento, resetarTimer, true);
    });
    resetarTimer();
}

// --- 1. MÁSCARA DE MOEDA ---
function aplicarMascaraMoeda(seletor) {
    const campo = document.querySelector(seletor);
    if (!campo) return;
    campo.addEventListener('input', (e) => {
        let valor = e.target.value.replace(/\D/g, "");
        if (valor === "") return;
        valor = (valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        e.target.value = valor;
    });
}

// --- UTILITÁRIOS ---
function formatarMoeda(valor) {
    let v = typeof valor === 'number' ? valor : limparMoeda(valor);
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function limparMoeda(valor) {
    if (!valor) return 0;
    let limpo = String(valor).replace(/[R$\s.]/g, '').replace(',', '.');
    return parseFloat(limpo) || 0;
}

function converterParaData(strData) {
    if (!strData) return null;
    const partes = strData.split('/');
    if (partes.length !== 3) return null;
    return new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]), 0, 0, 0);
}

// --- NAVEGAÇÃO ---
function showSection(id) {
    document.querySelectorAll('.app-section').forEach(s => s.style.display = 'none');
    const sec = document.getElementById('sec-' + id);
    if(sec) sec.style.display = 'block';
    
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const btnId = id === 'financeiro' ? 'btn-fin' : 'btn-' + id;
    if(document.getElementById(btnId)) document.getElementById(btnId).classList.add('active');
}

// --- DADOS ---
async function fetchData() {
    if (localStorage.getItem('mks_autenticado') !== 'true') return;

    try {
        const res = await fetch(`${URL_API}?t=${Date.now()}`, { redirect: 'follow' });
        const data = await res.json();
        DADOS_GLOBAIS = data;
        renderDash(); renderEstoque(); renderFinanceiro();
        document.getElementById('status-conexao').innerText = "Sincronizado";
        document.getElementById('dot-status').style.background = "#10b981";
    } catch (e) {
        document.getElementById('status-conexao').innerText = "Erro de Conexão";
        document.getElementById('dot-status').style.background = "#ef4444";
    }
}

function renderDash() {
    let entradasTotal = 0, saidasTotal = 0, vendasCount = 0;
    let lucroPotencialEstoque = 0;
    const valInicio = document.getElementById('dash-data-inicio').value;
    const valFim = document.getElementById('dash-data-fim').value;
    const filtroInicio = valInicio ? new Date(valInicio + 'T00:00:00') : null;
    const filtroFim = valFim ? new Date(valFim + 'T23:59:59') : null;

    DADOS_GLOBAIS.financeiro.forEach(f => {
        let v = limparMoeda(f.VALOR);
        let dataTransacao = converterParaData(f.DATA);
        let passFiltro = true;
        if (dataTransacao) {
            if (filtroInicio && dataTransacao < filtroInicio) passFiltro = false;
            if (filtroFim && dataTransacao > filtroFim) passFiltro = false;
        }
        if (passFiltro) {
            if (f.TIPO.toLowerCase().includes("venda")) { entradasTotal += v; vendasCount++; }
            else { saidasTotal += v; }
        }
    });

    DADOS_GLOBAIS.estoque.forEach(i => {
        if (i.STATUS === "Disponível") {
            lucroPotencialEstoque += (limparMoeda(i.VALOR_VENDA) - limparMoeda(i.VALOR_CUSTO));
        }
    });

    document.getElementById('dash-caixa').innerText = formatarMoeda(entradasTotal - saidasTotal);
    document.getElementById('dash-bruto').innerText = formatarMoeda(entradasTotal);
    document.getElementById('dash-saidas').innerText = formatarMoeda(saidasTotal);
    document.getElementById('dash-lucro-estoque').innerText = formatarMoeda(lucroPotencialEstoque);
    document.getElementById('dash-estoque-qtd').innerText = DADOS_GLOBAIS.estoque.filter(i => i.STATUS === "Disponível").length;
    document.getElementById('dash-ticket').innerText = formatarMoeda(vendasCount > 0 ? entradasTotal / vendasCount : 0);

    renderizarGrafico(filtroInicio, filtroFim);
}

function renderizarGrafico(fIni, fFim) {
    const canvas = document.getElementById('financeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (meuGrafico) meuGrafico.destroy();
    
    let transFiltradas = DADOS_GLOBAIS.financeiro.filter(f => {
        let dt = converterParaData(f.DATA);
        if (!dt) return true;
        if (fIni && dt < fIni) return false;
        if (fFim && dt > fFim) return false;
        return true;
    });

    const labels = [...new Set(transFiltradas.map(f => f.DATA))].slice(-10);
    const dadosVendas = labels.map(data => transFiltradas.filter(f => f.DATA === data && f.TIPO.toLowerCase().includes("venda")).reduce((acc, curr) => acc + limparMoeda(curr.VALOR), 0));
    const dadosCustos = labels.map(data => transFiltradas.filter(f => f.DATA === data && !f.TIPO.toLowerCase().includes("venda")).reduce((acc, curr) => acc + limparMoeda(curr.VALOR), 0));
    
    meuGrafico = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Vendas', data: dadosVendas, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4 },
                { label: 'Custos', data: dadosCustos, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function exportarEstoque() {
    let csv = 'ID/SN;Categoria;Produto;Detalhes;Qtd;Custo;Venda;Status\n';
    DADOS_GLOBAIS.estoque.forEach(i => {
        csv += `${i.ID_SN};${i.CATEGORIA};${i.PRODUTO};${i.DETALHES};${i.QTD};${i.VALOR_CUSTO};${i.VALOR_VENDA};${i.STATUS}\n`;
    });
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Estoque_MKS_${new Date().toLocaleDateString().replace(/\//g,'-')}.csv`;
    link.click();
}

function gerarID(cat) {
    const pref = cat === "iPhone" ? "apple" : (cat === "Notebook" ? "note" : "acess");
    const count = DADOS_GLOBAIS.estoque.filter(i => i.CATEGORIA === cat).length + 1;
    return `MKS-${pref}-${String(count).padStart(3, '0')}`;
}

function renderCamposDinamicos() {
    const cat = document.getElementById('add-categoria').value;
    document.getElementById('campos-dinamicos').innerHTML = `
        <label class="stat-label">ID / Serial Sugerido</label>
        <input type="text" id="f-sn" class="mks-input" value="${gerarID(cat)}">
        <input type="text" id="f-modelo" class="mks-input" placeholder="Nome/Modelo">
        <input type="text" id="f-detalhes" class="mks-input" placeholder="Detalhes">
        <div class="input-row">
            <input type="text" id="f-custo" class="mks-input" placeholder="Custo R$ 0,00">
            <input type="text" id="f-venda" class="mks-input" placeholder="Venda R$ 0,00">
        </div>
        <input type="number" id="f-qtd" class="mks-input" value="1">
    `;
    aplicarMascaraMoeda('#f-custo');
    aplicarMascaraMoeda('#f-venda');
}

function renderEstoque() {
    const filtro = document.getElementById('filtro-estoque').value.toLowerCase();
    const lista = document.getElementById('lista-estoque');
    let itens = DADOS_GLOBAIS.estoque.filter(i => String(i.ID_SN).toLowerCase().includes(filtro) || String(i.PRODUTO).toLowerCase().includes(filtro));
    itens.sort((a, b) => (a.STATUS === 'Vendido' ? 1 : -1));
    lista.innerHTML = itens.map(i => {
        const isVendido = i.STATUS === 'Vendido';
        return `<tr>
            <td><strong class="sn-badge">${i.ID_SN}</strong></td>
            <td>${i.CATEGORIA}</td><td>${i.PRODUTO}</td><td><small>${i.DETALHES}</small></td><td>${i.QTD}</td>
            <td>${formatarMoeda(i.VALOR_VENDA)}</td>
            <td><span class="status-pill ${isVendido ? 'red' : 'green'}">${i.STATUS}</span></td>
        </tr>`;
    }).join('');
}

function renderFinanceiro() {
    const filtro = document.getElementById('filtro-financeiro').value.toLowerCase();
    const lista = document.getElementById('lista-financeiro');
    lista.innerHTML = DADOS_GLOBAIS.financeiro
        .filter(f => String(f.DESCRICAO).toLowerCase().includes(filtro) || String(f.TIPO).toLowerCase().includes(filtro))
        .map(f => {
            const isVenda = f.TIPO.toLowerCase().includes('venda');
            return `<tr><td>${f.DATA}</td><td><span class="status-pill ${isVenda?'green':'red'}">${f.TIPO}</span></td><td>${f.DESCRICAO}</td><td class="${isVenda?'text-success':'text-danger'}">${formatarMoeda(f.VALOR)}</td><td>${f.PAGAMENTO || 'Outro'}</td></tr>`;
        }).reverse().join('');
}

function atualizarValorSugerido() {
    const sn = document.getElementById('venda-select-item').value;
    const item = DADOS_GLOBAIS.estoque.find(i => String(i.ID_SN) === String(sn));
    if (item) {
        document.getElementById('venda-valor-final').value = formatarMoeda(item.VALOR_VENDA);
    }
}

function abrirModalVenda() {
    const disp = DADOS_GLOBAIS.estoque.filter(i => i.STATUS === "Disponível");
    const select = document.getElementById('venda-select-item');
    select.innerHTML = disp.map(i => `<option value="${i.ID_SN}">${i.PRODUTO} (${i.ID_SN})</option>`).join('');
    document.getElementById('modalVenda').style.display = 'flex';
    document.getElementById('cli-nome').value = "";
    document.getElementById('cli-cpf').value = "";
    voltarPassoVenda();
    atualizarValorSugerido();
    aplicarMascaraMoeda('#venda-valor-final');
}

async function confirmarVendaFinal() {
    const nome = document.getElementById('cli-nome').value;
    const valorLimpo = limparMoeda(document.getElementById('venda-valor-final').value);
    
    if(!nome || valorLimpo <= 0) return alert("Preencha nome e valor!");
    if(!confirm(`Confirmar venda para ${nome} no valor de ${formatarMoeda(valorLimpo)}?`)) return;

    const btn = document.getElementById('btn-finalizar-venda');
    btn.innerText = "Processando..."; 
    btn.disabled = true;

    const sn = document.getElementById('venda-select-item').value;
    const item = DADOS_GLOBAIS.estoque.find(i => String(i.ID_SN) === String(sn));
    const cpf = document.getElementById('cli-cpf').value;

    const dadosVenda = { 
        acao: "VENDER_PRODUTO", 
        imei: sn, 
        produto: item.PRODUTO, 
        valorFinal: valorLimpo, 
        pagamento: document.getElementById('venda-pagamento').value, 
        cliente: nome + (cpf ? " (CPF: "+cpf+")" : "") 
    };

    try {
        await fetch(URL_API, { method: 'POST', mode: 'no-cors', body: JSON.stringify(dadosVenda) });

        document.getElementById('pdf-data').innerText = new Date().toLocaleDateString('pt-BR');
        document.getElementById('pdf-cliente').innerText = nome;
        document.getElementById('pdf-cpf').innerText = cpf || "---";
        document.getElementById('pdf-prod-nome').innerText = item.PRODUTO;
        document.getElementById('pdf-prod-sn').innerText = "SN: " + sn;
        document.getElementById('pdf-prod-valor').innerText = formatarMoeda(valorLimpo);
        document.getElementById('pdf-total').innerText = formatarMoeda(valorLimpo);
        
        const recibo = document.getElementById('area-recibo');
        recibo.style.display = 'block';

        await html2pdf().from(recibo).save(`Recibo_${nome}.pdf`);
        recibo.style.display = 'none';

        alert("Venda registrada e recibo gerado com sucesso!");
        location.reload();
    } catch (e) { 
        console.error("Erro na operação:", e);
        alert("Erro ao registrar venda. O recibo não foi gerado."); 
        btn.disabled = false; 
        btn.innerText = "Finalizar Venda"; 
    }
}

async function salvarProduto() {
    const modelo = document.getElementById('f-modelo').value;
    const custoRaw = document.getElementById('f-custo').value;
    const vendaRaw = document.getElementById('f-venda').value;

    if(!modelo) return alert("Digite o modelo!");
    if(!custoRaw || !vendaRaw) return alert("Preencha os valores de custo e venda!");
    if(!confirm(`Deseja cadastrar o produto ${modelo}?`)) return;

    const btn = document.getElementById('btn-salvar-produto');
    btn.innerText = "Enviando..."; btn.disabled = true;

    const dados = { 
        acao: "CADASTRAR_PRODUTO", 
        categoria: document.getElementById('add-categoria').value, 
        imei: document.getElementById('f-sn').value, 
        produto: modelo, 
        specs: document.getElementById('f-detalhes').value, 
        custo: limparMoeda(custoRaw), 
        valor: limparMoeda(vendaRaw), 
        qtd: document.getElementById('f-qtd').value 
    };
    await executarPost(dados, "Produto Cadastrado!");
}

async function executarPost(dados, msg) {
    try {
        await fetch(URL_API, { method: 'POST', mode: 'no-cors', body: JSON.stringify(dados) });
        alert(msg); location.reload();
    } catch (e) { alert("Erro ao enviar."); location.reload(); }
}

function abrirModalAdd() { document.getElementById('modalAdd').style.display = 'flex'; renderCamposDinamicos(); }
function fecharModal(id) { document.getElementById(id).style.display = 'none'; }
function proximoPassoVenda() { document.getElementById('venda-step-1').style.display = 'none'; document.getElementById('venda-step-2').style.display = 'block'; }
function voltarPassoVenda() { document.getElementById('venda-step-1').style.display = 'block'; document.getElementById('venda-step-2').style.display = 'none'; }

function toggleFiltrosMobile() {
    const container = document.getElementById('container-datas-mobile');
    if (container.style.display === 'none' || container.style.display === '') {
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
    }
}

async function realizarLogin() {
    const senha = document.getElementById('senha-login').value;
    const btn = document.getElementById('btn-entrar');
    const msg = document.getElementById('msg-login');

    if (!senha) return alert("Digite a senha!");
    btn.innerText = "Verificando...";
    btn.disabled = true;

    try {
        const response = await fetch(URL_API, {
            method: 'POST',
            body: JSON.stringify({ acao: "VERIFICAR_LOGIN", senha: senha })
        });
        const resultado = await response.text();

        if (resultado.trim() === "SUCESSO") {
            localStorage.setItem('mks_autenticado', 'true');
            document.getElementById('login-overlay').style.display = 'none';
            iniciarMonitoramento(); 
            fetchData(); // Busca dados após login bem sucedido
        } else {
            msg.innerText = "Senha incorreta!";
            msg.style.color = "#ef4444";
            btn.innerText = "Entrar";
            btn.disabled = false;
        }
    } catch (e) {
        alert("Erro de conexão.");
        btn.disabled = false;
        btn.innerText = "Entrar";
    }
}

function checarAcesso() {
    const loginOverlay = document.getElementById('login-overlay');
    if (localStorage.getItem('mks_autenticado') !== 'true') {
        if (loginOverlay) loginOverlay.style.display = 'flex';
    } else {
        if (loginOverlay) loginOverlay.style.display = 'none';
    }
}

// Inicialização organizada
checarAcesso(); 

window.onload = () => {
    checarAcesso(); 
    if (localStorage.getItem('mks_autenticado') === 'true') {
        iniciarMonitoramento();
        fetchData();
    }
};
