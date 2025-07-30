// --- ESTADO INICIAL E SELETORES DOM ---
const OPPORTUNITY_TTL_MS = 10000;
const DEFAULT_CAPITAL_STORAGE_KEY = 'arbitrageDashboard_defaultCapital_v1';
const MONITOR_PARES_EXPANDED_KEY = 'arbitrageDashboard_monitorParesExpanded_v1';
const WATCHED_PAIRS_EXPANDED_KEY = 'arbitrageDashboard_watchedPairsExpanded_v1';
const HIDDEN_WATCHED_OPS_STORAGE_KEY = 'arbitrageDashboard_hiddenWatchedOps_v1'; // Nova chave para localStorage

const state = {
  allPairsData: [],
  arbitrageOpportunities: [],
  config: {
    exchanges: {
        mexc: { spotMakerFee: 0.0000, futuresMakerFee: 0.0001, spotPollingIntervalMs: 1000, futuresPollingIntervalMs: 1000, blacklistedTokens:[] },
        gateio: { spotMakerFee: 0.0010, futuresMakerFee: 0.0002, spotPollingIntervalMs: 1200, futuresPollingIntervalMs: 1200, blacklistedTokens:[] }
    },
    arbitrage: {
        minProfitPercentage: 0.1,
        enableFuturesVsFutures: false,
        enableSpotVsSpot: false
    },
    monitoredPairs: []
  },
  defaultCapitalUSD: 0,
  connected: false,
  lastUpdated: null,
  maxOpportunitiesToShow: 30,
  sortColumn: 'netSpreadPercentage',
  sortDirection: 'desc',
  filters: {
    mexcSpot: true,
    mexcFutures: true,
    gateioSpot: true,
    gateioFutures: true,
    minVolume: 0,
    minProfitEFilterDisplay: 0,
    minProfitSFilterDisplay: 0,
    minFundingRate: null,
    maxFundingRate: null
  },
  isPaused: false,
  favoritedOps: [],
  blockedOps: [],
  watchedPairsList: [],
  hiddenWatchedOps: new Set(), // Alterado para Set para melhor performance
  soundEnabled: false,
  soundPermissionGranted: false,
  soundProfitThreshold: 0.0,
  soundPlayedForVisibleOps: new Set(),
  isWatchedPairsExpanded: false,
  isMonitorParesExpanded: false,
  sidebarCollapsed: false,
  currentView: 'arbitragens',
  showBlockedOps: false,
  isDarkTheme: false,
  currentUserSubscriptionStatus: null // Será populado após a requisição ao backend
};

window.frontendState = state;

const FAVORITES_STORAGE_KEY = 'arbitrageDashboard_favoritedOps_v1';
const BLOCKED_STORAGE_KEY = 'arbitrageDashboard_blockedOps_v2';
const THEME_STORAGE_KEY = 'arbitrageDashboard_theme_v1';

const ICON_COLLAPSED = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
const ICON_EXPANDED = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(90deg);"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

const opportunitiesTableBodyEl = document.getElementById("opportunities-table-body");
const pairsTableBodyEl = document.getElementById("pairs-table-body");
const pairCountMonitorEl = document.getElementById("pair-count-monitor");
const defaultCapitalInputEl = document.getElementById('default-capital-input');
const qtySugBaseUnitHeaderEl = document.getElementById('qty-sug-base-unit-header');

const elements = {
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  menuIcon: document.getElementById('menu-icon'),
  closeIcon: document.getElementById('close-icon'),
  navArbitragens: document.getElementById('nav-arbitragens'),
  navSaidaOp: document.getElementById('nav-saida-op'),
  navAmbosPositivos: document.getElementById('nav-ambos-positivos'),
  viewTitle: document.getElementById('view-title'),
  viewSubtitle: document.getElementById('view-subtitle'),
  connectionDot: document.getElementById('connection-dot'),
  connectionText: document.getElementById('connection-text'),
  lastUpdated: document.getElementById('last-updated'),
  toggleBlockedOps: document.getElementById('toggle-blocked-ops'),
  eyeIcon: document.getElementById('eye-icon'),
  eyeOffIcon: document.getElementById('eye-off-icon'),
  toggleSoundButton: document.getElementById('toggle-sound-button'),
  soundOnIcon: document.getElementById('sound-on-icon'),
  soundOffIcon: document.getElementById('sound-off-icon'),
  themeToggleButton: document.getElementById('theme-toggle-button'),
  sunIcon: document.getElementById('sun-icon'),
  moonIcon: document.getElementById('moon-icon'),
  togglePauseButton: document.getElementById('toggle-pause-button'),
  pauseIcon: document.getElementById('pause-icon'),
  playIcon: document.getElementById('play-icon'),
  mexcSpotFee: document.getElementById("mexc-spot-fee"),
  mexcFuturesFee: document.getElementById("mexc-futures-fee"),
  gateioSpotFee: document.getElementById("gateio-spot-fee"),
  gateioFuturesFee: document.getElementById("gateio-futures-fee"),
  minProfit: document.getElementById("min-profit"),
};

const filterCheckboxes = {
    mexcSpot: document.getElementById('filter-mexc-spot'),
    mexcFutures: document.getElementById('filter-mexc-futures'),
    gateioSpot: document.getElementById('filter-gateio-spot'),
    gateioFutures: document.getElementById('filter-gateio-futures')
};

const filterMinVolumeInput = document.getElementById('filter-min-volume');
const filterGroupLucroE = document.getElementById('filter-group-lucro-e');
const filterGroupLucroS = document.getElementById('filter-group-lucro-s');
const filterMinProfitEDisplayEl = document.getElementById('filter-min-profit-e-display');
const filterMinProfitSDisplayEl = document.getElementById('filter-min-profit-s-display');
const filterEnableFutFutEl = document.getElementById('filter-enable-fut-fut');
const filterEnableSpotSpotEl = document.getElementById('filter-enable-spot-spot');
const soundProfitThresholdInputEl = document.getElementById('sound-profit-threshold-input');
const watchPairInputEl = document.getElementById('watch-pair-input');
const addWatchPairButtonEl = document.getElementById('add-watch-pair-button');
const watchedPairsCountEl = document.getElementById('watched-pairs-count');
const blockedOpsCountEl = document.getElementById('blocked-ops-count');
const blockedOpsTableBodyEl = document.getElementById('blocked-ops-table-body');

const watchedPairsHeaderEl = document.getElementById('watched-pairs-header');
const watchedPairsTableContainerEl = document.getElementById('watched-pairs-table-container');
const watchedPairsToggleIconEl = document.getElementById('watched-pairs-toggle-icon');

const monitorParesHeaderEl = document.getElementById('monitor-pares-header');
const monitorParesTableContainerEl = document.getElementById('monitor-pares-table-container');
const monitorParesToggleIconEl = document.getElementById('monitor-pares-toggle-icon');
const filterFundingMinInput = document.getElementById('filter-funding-min');
const filterFundingMaxInput = document.getElementById('filter-funding-max');

let uiUpdateScheduled = false;
const UI_UPDATE_INTERVAL_MS = 200;
let ws = null;

function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, function (match) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#39;'
        }[match];
    });
}

function arredondarQuantidadeSugerida(qtdFloat) {
    if (qtdFloat > 0 && qtdFloat < 1) {
        return qtdFloat.toFixed(8);
    }
    if (qtdFloat >= 1) {
        return Math.floor(qtdFloat);
    }
    return 0;
}

function copiarParaClipboard(texto, buttonElement) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(texto)).then(() => {
            if(buttonElement){
                const originalText = buttonElement.textContent;
                buttonElement.textContent = '✓';
                setTimeout(() => { buttonElement.textContent = originalText; }, 1000);
            }
        }).catch(err => {
            console.error('FRONTEND: Falha ao copiar:', err);
        });
    }
}

function getExchangeUrl(exchange, instrument, pair) {
    const pairForURL = pair.replace('/', '_').toUpperCase();
    const exchangeLower = (exchange || '').toLowerCase();
    const instrumentUpper = (instrument || '').toUpperCase();
    const finalInstrument = (instrumentUpper === 'SPOT' || instrumentUpper === 'PONTO') ? 'spot' : 'futures';

    if (exchangeLower === 'mexc') {
        return finalInstrument === 'spot' ? `https://www.mexc.com/exchange/${pairForURL}?type=spot` : `https://futures.mexc.com/exchange/${pairForURL}`;
    } else if (exchangeLower === 'gateio' || exchangeLower === 'gate.io') {
        return finalInstrument === 'spot' ? `https://www.gate.io/trade/${pairForURL}` : `https://www.gate.io/futures_trade/USDT/${pairForURL}`;
    }
    return null;
}

function abrirJanelaDeGrafico(url, windowName, position) {
    if (!url) return;
    const screenWidth = window.screen.availWidth;
    const screenHeight = window.screen.availHeight;
    const windowWidth = Math.floor(screenWidth / 2) - 10;
    const windowHeight = screenHeight - 50;
    let left = (position === 'left') ? 0 : screenWidth - windowWidth;
    const features = `width=${windowWidth},height=${windowHeight},left=${left},top=0,resizable=yes,scrollbars=yes`;
    const newWindow = window.open(url, windowName, features);
    if (newWindow) newWindow.focus();
}

function abrirCalculadora(pair, direction, buyEx, sellEx, forceNewWindow = false) {
    const url = `realtime_profit_calc.html?pair=${encodeURIComponent(pair)}&direction=${encodeURIComponent(direction)}&buyEx=${encodeURIComponent(buyEx)}&sellEx=${encodeURIComponent(sellEx)}`;
    const windowName = forceNewWindow ? '_blank' : 'arbitrage_calculator_window';
    const popWidth = 420;
    const popHeight = 220;
    const left = (window.screen.availWidth / 2) - (popWidth / 2);
    const top = (window.screen.availHeight / 2) - (popHeight / 2);
    const features = `width=${popWidth},height=${popHeight},top=${top},left=${left},resizable=yes,scrollbars=yes`;
    const calcWindow = window.open(url, windowName, features);
    if (calcWindow) {
        calcWindow.focus();
    }
}

function abrirGraficosComLayout(buyExchange, buyInstrument, sellExchange, sellInstrument, pair, direction, opDataForCopyStr) {
    // 1. Parse dos dados da oportunidade
    let opDataToUse = null;
    if (typeof opDataForCopyStr === 'string' && opDataForCopyStr) {
        try {
            opDataToUse = JSON.parse(opDataForCopyStr.replace(/&quot;/g, '"'));
        } catch (e) {
            console.error("FRONTEND: Falha ao parsear opDataForCopyStr", e);
        }
    }

    // 2. Calcular e copiar o valor primeiro, enquanto a página principal tem foco
    if (opDataToUse && opDataToUse.buyPrice && state.defaultCapitalUSD > 0) {
        const buyPrice = parseFloat(opDataToUse.buyPrice);
        if (buyPrice > 0) {
            const qtdOriginal = state.defaultCapitalUSD / buyPrice;
            const qtdSugerida = arredondarQuantidadeSugerida(qtdOriginal);
            if (parseFloat(qtdSugerida) > 0) {
                copiarParaClipboard(qtdSugerida);
            }
        }
    }

    // 3. Abrir todas as janelas o mais rápido possível, sem pausas
    abrirCalculadora(pair, direction, buyExchange, sellExchange);

    let urlLeg1 = getExchangeUrl(buyExchange, buyInstrument, pair);
    let urlLeg2 = getExchangeUrl(sellExchange, sellInstrument, pair);
    
    if (urlLeg1 === urlLeg2) {
        window.open(urlLeg1, '_blank');
    } else {
        abrirJanelaDeGrafico(urlLeg1, 'arbitrage_leg1_window', 'left');
        abrirJanelaDeGrafico(urlLeg2, 'arbitrage_leg2_window', 'right');
    }
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  elements.sidebar.classList.toggle('collapsed');
}

function setCurrentView(view) {
  if (state.currentUserSubscriptionStatus === 'free' && (view === 'saida-op' || view === 'ambos-positivos')) {
    showUpgradeAlert();
    return;
  }
  state.currentView = view;
  if (view === 'saida-op') {
    state.sortColumn = 'lucroS';
    state.sortDirection = 'desc';
    filterGroupLucroE.style.display = 'none';
    filterGroupLucroS.style.display = 'flex';
  } else {
    state.sortColumn = 'netSpreadPercentage';
    state.sortDirection = 'desc';
    filterGroupLucroE.style.display = 'flex';
    filterGroupLucroS.style.display = 'none';
  }
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.getElementById(`nav-${view}`).classList.add('active');
  updateMainTitle();
  requestUiUpdate();
}

function updateMainTitle() {
    const filteredOpportunities = getFilteredOpportunities();
    const count = filteredOpportunities.length;
    const viewTitles = {
        'arbitragens': 'Entrada OP',
        'saida-op': 'Monitor de Saída',
        'ambos-positivos': 'Ambos Positivos'
    };
    const viewSubtitles = {
        'arbitragens': 'Oportunidades com Entrada positiva',
        'saida-op': 'Oportunidades com Saída positiva',
        'ambos-positivos': 'Oportunidades com Entrada e Saída positivas'
    };
    if (elements.viewTitle) elements.viewTitle.textContent = `${viewTitles[state.currentView]} (${count})`;
    if (elements.viewSubtitle) elements.viewSubtitle.textContent = viewSubtitles[state.currentView];
}

function toggleBlockedOps() {
  state.showBlockedOps = !state.showBlockedOps;
  const text = elements.toggleBlockedOps?.querySelector('span');
  const blockedTableContainer = document.getElementById('blocked-ops-table-container');
  if (state.showBlockedOps) {
    elements.eyeIcon.style.display = 'block';
    elements.eyeOffIcon.style.display = 'none';
    text.textContent = 'Esconder Oportunidades Bloqueadas';
    blockedTableContainer.style.display = '';
  } else {
    elements.eyeIcon.style.display = 'none';
    elements.eyeOffIcon.style.display = 'block';
    text.textContent = 'Mostrar Oportunidades Bloqueadas';
    blockedTableContainer.style.display = 'none';
  }
}

function getFilteredOpportunities() {
    let opportunities = state.arbitrageOpportunities.filter(opWrapper => {
        const op = opWrapper.data;
        if (state.watchedPairsList.includes(op.pair)) return false;
        if (state.blockedOps.some(blockedOp => `${op.pair}-${op.direction}` === blockedOp.key)) return false;

        if (state.currentView === 'arbitragens') {
            if (!(op.netSpreadPercentage > 0 && op.netSpreadPercentage >= state.filters.minProfitEFilterDisplay)) {
                return false;
            }
        } else if (state.currentView === 'saida-op') {
            const lucroS = calculateLucroS(op, state.allPairsData, state.config);
            if (lucroS === null || lucroS <= 0 || lucroS < state.filters.minProfitSFilterDisplay) {
                return false;
            }
        } else if (state.currentView === 'ambos-positivos') {
            const lucroS = calculateLucroS(op, state.allPairsData, state.config);
            if (!(op.netSpreadPercentage > 0 && lucroS > 0)) {
                return false;
            }
        }

        const isFutFut = (op.buyInstrument?.toLowerCase().includes('futur')) && (op.sellInstrument?.toLowerCase().includes('futur'));
        const isSpotSpot = (op.buyInstrument?.toLowerCase().includes('spot')) && (op.sellInstrument?.toLowerCase().includes('spot'));

        if (state.currentUserSubscriptionStatus === 'free' && (isFutFut || isSpotSpot)) {
            return false;
        }

        if (isFutFut && !state.config.arbitrage.enableFuturesVsFutures) return false;
        if (isSpotSpot && !state.config.arbitrage.enableSpotVsSpot) return false;

        const volume = getVolumeForFiltering(op);
        if (state.filters.minVolume > 0 && volume < state.filters.minVolume) return false;

        const buyExchange = op.buyExchange?.toLowerCase();
        const sellExchange = op.sellExchange?.toLowerCase();
        const buyMarket = op.buyInstrument?.toLowerCase();
        const sellMarket = op.sellInstrument?.toLowerCase();

        let buyAllowed = (buyExchange === 'mexc' && (buyMarket === 'spot' || buyMarket === 'ponto') && state.filters.mexcSpot) ||
                         (buyExchange === 'mexc' && (buyMarket === 'futures' || buyMarket === 'futuros') && state.filters.mexcFutures) ||
                         (buyExchange === 'gateio' && (buyMarket === 'spot' || buyMarket === 'ponto') && state.filters.gateioSpot) ||
                         (buyExchange === 'gateio' && (buyMarket === 'futures' || buyMarket === 'futuros') && state.filters.gateioFutures);

        let sellAllowed = (sellExchange === 'mexc' && (sellMarket === 'spot' || sellMarket === 'ponto') && state.filters.mexcSpot) ||
                          (sellExchange === 'mexc' && (sellMarket === 'futures' || sellMarket === 'futuros') && state.filters.mexcFutures) ||
                          (sellExchange === 'gateio' && (sellMarket === 'spot' || sellMarket === 'ponto') && state.filters.gateioSpot) ||
                          (sellExchange === 'gateio' && (sellMarket === 'futures' || sellMarket === 'futuros') && state.filters.gateioFutures);

        return buyAllowed && sellAllowed;
    });

    // Aplica o filtro de funding rate
    opportunities = opportunities.filter(opWrapper => {
        const op = opWrapper.data;
        const fundingRate = op.fundingRate;

        if (state.filters.minFundingRate !== null && fundingRate < state.filters.minFundingRate) {
            return false;
        }
        if (state.filters.maxFundingRate !== null && fundingRate > state.filters.maxFundingRate) {
            return false;
        }
        return true;
    });

    return opportunities;
}

function calculateLucroS(op, allPairsData, config) {
    // Implementação da função calculateLucroS (assumindo que já existe ou será fornecida)
    // Esta é uma função placeholder, você deve ter a lógica real aqui.
    // Se esta função não existir, as visualizações de Saída OP e Ambos Positivos não funcionarão corretamente.
    return op.lucroS || 0; // Retorna o lucro de saída se existir, senão 0
}

function getVolumeForFiltering(op) {
    // Implementação da função getVolumeForFiltering (assumindo que já existe ou será fornecida)
    // Esta é uma função placeholder, você deve ter a lógica real aqui.
    return op.volume || 0; // Retorna o volume se existir, senão 0
}

// --- LÓGICA DE WEBSOCKET ---
function connectWebSocket() {
  if (ws) {
    ws.close();
  }
  ws = new WebSocket(`ws://${window.location.host}`);

  ws.onopen = () => {
    console.log('WebSocket conectado!');
    state.connected = true;
    elements.connectionDot.classList.remove('disconnected');
    elements.connectionDot.classList.add('connected');
    elements.connectionText.textContent = 'Conectado';
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'arbitrageOpportunities') {
      state.allPairsData = data.allPairsData; // Atualiza todos os dados de pares
      state.arbitrageOpportunities = data.opportunities.map(op => ({ data: op, timestamp: Date.now() }));
      state.lastUpdated = new Date();
      requestUiUpdate();
    } else if (data.type === 'config') {
        // Atualiza as configurações do bot (taxas, etc.)
        state.config = { ...state.config, ...data.config };
        updateFeeDisplay();
    }
  };

  ws.onclose = () => {
    console.log('WebSocket desconectado. Tentando reconectar em 5 segundos...');
    state.connected = false;
    elements.connectionDot.classList.remove('connected');
    elements.connectionDot.classList.add('disconnected');
    elements.connectionText.textContent = 'Desconectado';
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket erro:', error);
    ws.close();
  };
}

// --- FUNÇÕES DE ATUALIZAÇÃO DA UI ---
function requestUiUpdate() {
  if (!uiUpdateScheduled) {
    uiUpdateScheduled = true;
    setTimeout(() => {
      updateUI();
      uiUpdateScheduled = false;
    }, UI_UPDATE_INTERVAL_MS);
  }
}

function updateUI() {
  updateMainTitle();
  updateOpportunitiesTable();
  updateBlockedOpsTable();
  updateWatchedPairsTable();
  updateMonitorParesTable();
  updateLastUpdatedDisplay();
}

function updateOpportunitiesTable() {
  const filteredOpportunities = getFilteredOpportunities();
  const sortedOpportunities = filteredOpportunities.sort((a, b) => {
    const valA = a.data[state.sortColumn];
    const valB = b.data[state.sortColumn];
    if (state.sortDirection === 'asc') {
      return valA - valB;
    } else {
      return valB - valA;
    }
  });

  opportunitiesTableBodyEl.innerHTML = '';
  if (sortedOpportunities.length === 0) {
    opportunitiesTableBodyEl.innerHTML = '<tr><td colspan="10" class="no-data">Nenhuma oportunidade encontrada com os filtros atuais.</td></tr>';
    return;
  }

  sortedOpportunities.slice(0, state.maxOpportunitiesToShow).forEach(opWrapper => {
    const op = opWrapper.data;
    const row = opportunitiesTableBodyEl.insertRow();
    row.classList.add('opportunity-row');
    row.dataset.pair = op.pair;
    row.dataset.direction = op.direction;

    const isFavorited = state.favoritedOps.includes(`${op.pair}-${op.direction}`);
    const isBlocked = state.blockedOps.some(blockedOp => `${op.pair}-${op.direction}` === blockedOp.key);

    const lucroS = calculateLucroS(op, state.allPairsData, state.config);
    const qtdSugerida = arredondarQuantidadeSugerida(state.defaultCapitalUSD / op.buyPrice);

    // Adiciona a classe 'premium-feature' para oportunidades que são Futuros vs Futuros ou Spot vs Spot
    const isFutFut = (op.buyInstrument?.toLowerCase().includes('futur')) && (op.sellInstrument?.toLowerCase().includes('futur'));
    const isSpotSpot = (op.buyInstrument?.toLowerCase().includes('spot')) && (op.sellInstrument?.toLowerCase().includes('spot'));
    if (isFutFut || isSpotSpot) {
        row.classList.add('premium-feature-row');
    }

    row.innerHTML = `
      <td>
        <button class="favorite-button ${isFavorited ? 'favorited' : ''}" data-pair="${op.pair}" data-direction="${op.direction}">
          <svg viewBox="0 0 24 24" fill="${isFavorited ? 'gold' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
        <button class="block-button ${isBlocked ? 'blocked' : ''}" data-pair="${op.pair}" data-direction="${op.direction}">
          <svg viewBox="0 0 24 24" fill="${isBlocked ? 'red' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0110 0v4"></path>
          </svg>
        </button>
        ${op.pair}
      </td>
      <td>${op.buyExchange} ${op.buyInstrument} ${op.buyPrice}</td>
      <td>${op.sellExchange} ${op.sellInstrument} ${op.sellPrice}</td>
      <td class="${op.netSpreadPercentage > 0 ? 'positive' : 'negative'}">${op.netSpreadPercentage.toFixed(4)}%</td>
      <td class="${lucroS > 0 ? 'positive' : 'negative'}">${lucroS.toFixed(4)}%</td>
      <td>${formatVolume(op.volume)} / ${formatVolume(op.volumeFutures)}</td>
      <td>${op.fundingRate !== null ? (op.fundingRate * 100).toFixed(4) + '%' : 'N/A'}</td>
      <td>${qtdSugerida}</td>
      <td>${formatTimeAgo(op.firstSeen)}</td>
      <td>
        <button class="calculator-button" 
                data-pair="${op.pair}" 
                data-direction="${op.direction}" 
                data-buy-ex="${op.buyExchange}" 
                data-sell-ex="${op.sellExchange}"
                data-op-data='${JSON.stringify(op)}'>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
            <path d="M12 16h.01"></path>
            <path d="M16 16h.01"></path>
            <path d="M8 16h.01"></path>
            <path d="M12 12h.01"></path>
            <path d="M16 12h.01"></path>
            <path d="M8 12h.01"></path>
          </svg>
        </button>
      </td>
    `;
  });

  addEventListenersToButtons();
}

function updateBlockedOpsTable() {
    blockedOpsTableBodyEl.innerHTML = '';
    if (state.blockedOps.length === 0) {
        blockedOpsTableBodyEl.innerHTML = '<tr><td colspan="8" class="no-data">Nenhuma oportunidade bloqueada.</td></tr>';
        return;
    }

    state.blockedOps.forEach(blockedOp => {
        const row = blockedOpsTableBodyEl.insertRow();
        row.classList.add('blocked-op-row');
        row.dataset.key = blockedOp.key;

        row.innerHTML = `
            <td>${blockedOp.pair}</td>
            <td>${blockedOp.buyExchange} ${blockedOp.buyInstrument} ${blockedOp.buyPrice}</td>
            <td>${blockedOp.sellExchange} ${blockedOp.sellInstrument} ${blockedOp.sellPrice}</td>
            <td>${blockedOp.netSpreadPercentage.toFixed(4)}%</td>
            <td>${blockedOp.lucroS.toFixed(4)}%</td>
            <td>${formatVolume(blockedOp.volume)} / ${formatVolume(blockedOp.volumeFutures)}</td>
            <td>${blockedOp.fundingRate !== null ? (blockedOp.fundingRate * 100).toFixed(4) + '%' : 'N/A'}</td>
            <td>
                <button class="unblock-button" data-key="${blockedOp.key}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0110 0v4"></path>
                        <path d="M12 15v.01"></path>
                    </svg>
                </button>
            </td>
        `;
    });
    addEventListenersToButtons();
}

function updateWatchedPairsTable() {
    const watchedPairsTableBodyEl = document.getElementById('watched-pairs-table-body');
    watchedPairsTableBodyEl.innerHTML = '';
    watchedPairsCountEl.textContent = state.watchedPairsList.length;

    if (state.watchedPairsList.length === 0) {
        watchedPairsTableBodyEl.innerHTML = '<tr><td colspan="8" class="no-data">Nenhum par em vigilância.</td></tr>';
        return;
    }

    state.watchedPairsList.forEach(pair => {
        const op = state.arbitrageOpportunities.find(opWrapper => opWrapper.data.pair === pair)?.data;
        if (!op) return; // Oportunidade não encontrada, talvez ainda não tenha chegado via WS

        const row = watchedPairsTableBodyEl.insertRow();
        row.classList.add('watched-pair-row');
        row.dataset.pair = op.pair;

        const lucroS = calculateLucroS(op, state.allPairsData, state.config);

        row.innerHTML = `
            <td>
                <button class="remove-watch-pair-button" data-pair="${op.pair}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                ${op.pair}
            </td>
            <td>${op.buyExchange} ${op.buyInstrument} ${op.buyPrice}</td>
            <td>${op.sellExchange} ${op.sellInstrument} ${op.sellPrice}</td>
            <td class="${op.netSpreadPercentage > 0 ? 'positive' : 'negative'}">${op.netSpreadPercentage.toFixed(4)}%</td>
            <td class="${lucroS > 0 ? 'positive' : 'negative'}">${lucroS.toFixed(4)}%</td>
            <td>${formatVolume(op.volume)} / ${formatVolume(op.volumeFutures)}</td>
            <td>${op.fundingRate !== null ? (op.fundingRate * 100).toFixed(4) + '%' : 'N/A'}</td>
            <td>${formatTimeAgo(op.firstSeen)}</td>
        `;
    });
    addEventListenersToButtons();
}

function updateMonitorParesTable() {
    pairsTableBodyEl.innerHTML = '';
    pairCountMonitorEl.textContent = state.allPairsData.length;

    if (state.allPairsData.length === 0) {
        pairsTableBodyEl.innerHTML = '<tr><td colspan="8" class="no-data">Aguardando dados dos pares...</td></tr>';
        return;
    }

    state.allPairsData.forEach(pairData => {
        const row = pairsTableBodyEl.insertRow();
        row.innerHTML = `
            <td>${pairData.exchange}</td>
            <td>${pairData.pair}</td>
            <td>${pairData.spotAsk}</td>
            <td>${pairData.futuresAsk}</td>
            <td>${pairData.spotBid}</td>
            <td>${pairData.futuresBid}</td>
            <td>${pairData.timestampSpot}</td>
            <td>${pairData.timestampFutures}</td>
        `;
    });
}

function updateLastUpdatedDisplay() {
  if (state.lastUpdated) {
    const now = new Date();
    const diffMs = now.getTime() - state.lastUpdated.getTime();
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    let timeAgo = '';
    if (hours > 0) {
      timeAgo = `${hours}h atrás`;
    } else if (minutes > 0) {
      timeAgo = `${minutes}m atrás`;
    } else {
      timeAgo = `${seconds}s atrás`;
    }
    elements.lastUpdated.textContent = `Última atualização: ${timeAgo}`;
  } else {
    elements.lastUpdated.textContent = 'Última atualização: --:--:--';
  }
}

function updateFeeDisplay() {
    if (elements.mexcSpotFee) elements.mexcSpotFee.textContent = (state.config.exchanges.mexc.spotMakerFee * 100).toFixed(3);
    if (elements.mexcFuturesFee) elements.mexcFuturesFee.textContent = (state.config.exchanges.mexc.futuresMakerFee * 100).toFixed(3);
    if (elements.gateioSpotFee) elements.gateioSpotFee.textContent = (state.config.exchanges.gateio.spotMakerFee * 100).toFixed(3);
    if (elements.gateioFuturesFee) elements.gateioFuturesFee.textContent = (state.config.exchanges.gateio.futuresMakerFee * 100).toFixed(3);
}

function formatVolume(volume) {
    if (volume >= 1000000) {
        return (volume / 1000000).toFixed(1) + 'M';
    } else if (volume >= 1000) {
        return (volume / 1000).toFixed(0) + 'K';
    } else {
        return volume.toFixed(0);
    }
}

function formatTimeAgo(timestamp) {
    const now = Date.now();
    const seconds = Math.floor((now - timestamp) / 1000);

    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m`;
    } else if (seconds < 86400) {
        return `${Math.floor(seconds / 3600)}h`;
    } else {
        return `${Math.floor(seconds / 86400)}d`;
    }
}

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
  // Carrega o tema salvo
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === 'dark') {
    document.body.classList.add('dark');
    elements.sunIcon.style.display = 'none';
    elements.moonIcon.style.display = 'block';
  } else {
    document.body.classList.remove('dark');
    elements.sunIcon.style.display = 'block';
    elements.moonIcon.style.display = 'none';
  }

  // Carrega o capital padrão salvo
  const savedCapital = localStorage.getItem(DEFAULT_CAPITAL_STORAGE_KEY);
  if (savedCapital) {
    state.defaultCapitalUSD = parseFloat(savedCapital);
    defaultCapitalInputEl.value = state.defaultCapitalUSD;
  }

  // Carrega os pares favoritos e bloqueados
  state.favoritedOps = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
  state.blockedOps = JSON.parse(localStorage.getItem(BLOCKED_STORAGE_KEY) || '[]');
  state.hiddenWatchedOps = new Set(JSON.parse(localStorage.getItem(HIDDEN_WATCHED_OPS_STORAGE_KEY) || '[]'));

  // Carrega o estado de expansão dos painéis
  state.isWatchedPairsExpanded = JSON.parse(localStorage.getItem(WATCHED_PAIRS_EXPANDED_KEY) || 'false');
  if (state.isWatchedPairsExpanded) {
    watchedPairsTableContainerEl.style.display = '';
    watchedPairsToggleIconEl.innerHTML = ICON_EXPANDED;
  } else {
    watchedPairsTableContainerEl.style.display = 'none';
    watchedPairsToggleIconEl.innerHTML = ICON_COLLAPSED;
  }

  state.isMonitorParesExpanded = JSON.parse(localStorage.getItem(MONITOR_PARES_EXPANDED_KEY) || 'false');
  if (state.isMonitorParesExpanded) {
    monitorParesTableContainerEl.style.display = '';
    monitorParesToggleIconEl.innerHTML = ICON_EXPANDED;
  } else {
    monitorParesTableContainerEl.style.display = 'none';
    monitorParesToggleIconEl.innerHTML = ICON_COLLAPSED;
  }

  // Event Listeners para os filtros
  Object.values(filterCheckboxes).forEach(checkbox => {
    checkbox.addEventListener('change', requestUiUpdate);
  });
  filterMinVolumeInput.addEventListener('input', (e) => {
    state.filters.minVolume = parseFloat(e.target.value) || 0;
    requestUiUpdate();
  });
  filterMinProfitEDisplayEl.addEventListener('change', (e) => {
    state.filters.minProfitEFilterDisplay = parseFloat(e.target.value);
    requestUiUpdate();
  });
  filterMinProfitSDisplayEl.addEventListener('change', (e) => {
    state.filters.minProfitSFilterDisplay = parseFloat(e.target.value);
    requestUiUpdate();
  });
  filterEnableFutFutEl.addEventListener('change', (e) => {
    state.config.arbitrage.enableFuturesVsFutures = e.target.checked;
    requestUiUpdate();
  });
  filterEnableSpotSpotEl.addEventListener('change', (e) => {
    state.config.arbitrage.enableSpotVsSpot = e.target.checked;
    requestUiUpdate();
  });
  filterFundingMinInput.addEventListener('input', (e) => {
    state.filters.minFundingRate = e.target.value === '' ? null : parseFloat(e.target.value);
    requestUiUpdate();
  });
  filterFundingMaxInput.addEventListener('input', (e) => {
    state.filters.maxFundingRate = e.target.value === '' ? null : parseFloat(e.target.value);
    requestUiUpdate();
  });

  // Event Listeners para os botões de navegação
  elements.navArbitragens.addEventListener('click', () => setCurrentView('arbitragens'));
  elements.navSaidaOp.addEventListener('click', () => setCurrentView('saida-op'));
  elements.navAmbosPositivos.addEventListener('click', () => setCurrentView('ambos-positivos'));

  // Event Listener para o botão de logout
  document.getElementById('logout-button').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/users/logout', { method: 'POST' });
      if (response.ok) {
        window.location.href = '/login.html';
      } else {
        console.error('Erro ao fazer logout');
        alert('Erro ao fazer logout. Tente novamente.');
      }
    } catch (error) {
      console.error('Erro de conexão ao fazer logout:', error);
      alert('Erro de conexão. Tente novamente.');
    }
  });

  // Event Listener para o input de capital padrão
  defaultCapitalInputEl.addEventListener('input', (e) => {
    state.defaultCapitalUSD = parseFloat(e.target.value) || 0;
    localStorage.setItem(DEFAULT_CAPITAL_STORAGE_KEY, state.defaultCapitalUSD);
    requestUiUpdate();
  });

  // Event Listener para o botão de alternar som
  elements.toggleSoundButton.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    if (state.soundEnabled) {
      elements.soundOnIcon.style.display = 'block';
      elements.soundOffIcon.style.display = 'none';
      // Solicita permissão de áudio se ainda não foi concedida
      if (!state.soundPermissionGranted) {
        // Tenta tocar um som silencioso para obter permissão
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = 0; // Volume zero
        oscillator.start(0);
        oscillator.stop(audioContext.currentTime + 0.1); // Toca por 0.1 segundos
        state.soundPermissionGranted = true;
      }
    } else {
      elements.soundOnIcon.style.display = 'none';
      elements.soundOffIcon.style.display = 'block';
    }
  });

  // Event Listener para o input de limite de lucro para som
  soundProfitThresholdInputEl.addEventListener('input', (e) => {
    state.soundProfitThreshold = parseFloat(e.target.value) || 0.0;
  });

  // Event Listener para o botão de alternar tema
  elements.themeToggleButton.addEventListener('click', () => {
    state.isDarkTheme = !state.isDarkTheme;
    if (state.isDarkTheme) {
      document.body.classList.add('dark');
      elements.sunIcon.style.display = 'none';
      elements.moonIcon.style.display = 'block';
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    } else {
      document.body.classList.remove('dark');
      elements.sunIcon.style.display = 'block';
      elements.moonIcon.style.display = 'none';
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
    }
  });

  // Event Listener para o botão de pausar/continuar
  elements.togglePauseButton.addEventListener('click', () => {
    state.isPaused = !state.isPaused;
    if (state.isPaused) {
      elements.pauseIcon.style.display = 'block';
      elements.playIcon.style.display = 'none';
      if (ws) ws.close(); // Fecha o WebSocket para pausar a atualização de dados
    } else {
      elements.pauseIcon.style.display = 'none';
      elements.playIcon.style.display = 'block';
      connectWebSocket(); // Reconecta o WebSocket para continuar a atualização
    }
  });

  // Event Listener para o botão de alternar oportunidades bloqueadas
  elements.toggleBlockedOps.addEventListener('click', toggleBlockedOps);

  // Event Listener para o botão de adicionar par em vigilância
  addWatchPairButtonEl.addEventListener('click', () => {
    const pair = watchPairInputEl.value.trim().toUpperCase();
    if (pair && !state.watchedPairsList.includes(pair)) {
      state.watchedPairsList.push(pair);
      localStorage.setItem('arbitrageDashboard_watchedPairs_v1', JSON.stringify(state.watchedPairsList));
      watchPairInputEl.value = '';
      requestUiUpdate();
    }
  });

  // Event Listener para expandir/colapsar Pares em Vigilância
  watchedPairsHeaderEl.addEventListener('click', () => {
    state.isWatchedPairsExpanded = !state.isWatchedPairsExpanded;
    localStorage.setItem(WATCHED_PAIRS_EXPANDED_KEY, JSON.stringify(state.isWatchedPairsExpanded));
    if (state.isWatchedPairsExpanded) {
      watchedPairsTableContainerEl.style.display = '';
      watchedPairsToggleIconEl.innerHTML = ICON_EXPANDED;
    } else {
      watchedPairsTableContainerEl.style.display = 'none';
      watchedPairsToggleIconEl.innerHTML = ICON_COLLAPSED;
    }
  });

  // Event Listener para expandir/colapsar Monitor de Pares
  monitorParesHeaderEl.addEventListener('click', () => {
    state.isMonitorParesExpanded = !state.isMonitorParesExpanded;
    localStorage.setItem(MONITOR_PARES_EXPANDED_KEY, JSON.stringify(state.isMonitorParesExpanded));
    if (state.isMonitorParesExpanded) {
      monitorParesTableContainerEl.style.display = '';
      monitorParesToggleIconEl.innerHTML = ICON_EXPANDED;
    } else {
      monitorParesTableContainerEl.style.display = 'none';
      monitorParesToggleIconEl.innerHTML = ICON_COLLAPSED;
    }
  });

  // Inicializa a conexão WebSocket
  connectWebSocket();

  // --- LÓGICA DE ASSINATURA (NOVO) ---
  async function fetchUserData() {
    try {
      const response = await fetch('/api/users/me');
      if (response.ok) {
        const data = await response.json();
        state.currentUserSubscriptionStatus = data.user.subscriptionStatus; // Assume que a API retorna { user: { subscriptionStatus: '...' } }
        applySubscriptionRestrictions();
      } else if (response.status === 401) {
        // Usuário não autenticado, redireciona para o login
        window.location.href = '/login.html';
      } else {
        console.error('Erro ao buscar dados do usuário:', response.statusText);
        // Mantém o status como null ou um padrão seguro
        state.currentUserSubscriptionStatus = 'free'; // Assume free em caso de erro para não bloquear tudo
        applySubscriptionRestrictions();
      }
    } catch (error) {
      console.error('Erro de conexão ao buscar dados do usuário:', error);
      // Em caso de erro de rede, assume free para não bloquear o acesso
      state.currentUserSubscriptionStatus = 'free';
      applySubscriptionRestrictions();
    }
  }

  function showUpgradeAlert() {
    const upgradeMessageEl = document.getElementById('upgrade-message');
    const testVersionBannerEl = document.getElementById('test-version-banner');

    if (upgradeMessageEl) {
      upgradeMessageEl.innerHTML = `
        <div class="alert-banner premium-alert">
          <p>Você está usando a versão gratuita. Faça upgrade para o plano Premium para desbloquear todas as funcionalidades!</p>
          <button class="banner-upgrade-button" onclick="window.location.href='http://arbflash.com/'">Assinar Premium</button>
        </div>
      `;
      upgradeMessageEl.style.display = 'block';
    }

    if (testVersionBannerEl) {
      testVersionBannerEl.style.display = 'flex'; // Exibe o banner de teste
      testVersionBannerEl.querySelector('.banner-upgrade-button').onclick = () => {
        window.location.href = 'http://arbflash.com/';
      };
      testVersionBannerEl.querySelector('.banner-close').onclick = () => {
        testVersionBannerEl.style.display = 'none';
      };
    }
  }

  function applySubscriptionRestrictions() {
    const isFreeUser = state.currentUserSubscriptionStatus === 'free';

    // 1. Exibir/Esconder o banner de upgrade
    if (isFreeUser) {
      showUpgradeAlert();
    } else {
      document.getElementById('upgrade-message').style.display = 'none';
      document.getElementById('test-version-banner').style.display = 'none';
    }

    // 2. Bloquear navegação para Saída OP e Ambos Positivos (visual)
    const navSaidaOp = document.getElementById('nav-saida-op');
    const navAmbosPositivos = document.getElementById('nav-ambos-positivos');

    if (navSaidaOp) {
      if (isFreeUser) {
        navSaidaOp.classList.add('locked-feature');
        navSaidaOp.title = 'Funcionalidade Premium';
        navSaidaOp.querySelector('.nav-item-text').innerHTML += ' <span class="lock-icon">🔒</span>';
      } else {
        navSaidaOp.classList.remove('locked-feature');
        navSaidaOp.title = '';
        // Remover o ícone de cadeado se existir
        const lockIcon = navSaidaOp.querySelector('.lock-icon');
        if (lockIcon) lockIcon.remove();
      }
    }

    if (navAmbosPositivos) {
      if (isFreeUser) {
        navAmbosPositivos.classList.add('locked-feature');
        navAmbosPositivos.title = 'Funcionalidade Premium';
        navAmbosPositivos.querySelector('.nav-item-text').innerHTML += ' <span class="lock-icon">🔒</span>';
      } else {
        navAmbosPositivos.classList.remove('locked-feature');
        navAmbosPositivos.title = '';
        const lockIcon = navAmbosPositivos.querySelector('.lock-icon');
        if (lockIcon) lockIcon.remove();
      }
    }

    // 3. Bloquear filtros avançados (Futuros vs Futuros, Spot vs Spot, Volume Mín, Financ.)
    const premiumFilters = [
      filterEnableFutFutEl.closest('.filter-group'),
      filterEnableSpotSpotEl.closest('.filter-group'),
      filterMinVolumeInput.closest('.filter-group'),
      filterFundingMinInput.closest('.filter-group')
    ];

    premiumFilters.forEach(group => {
      if (group) {
        if (isFreeUser) {
          group.classList.add('locked-feature');
          group.title = 'Funcionalidade Premium';
          // Adicionar ícone de cadeado ao lado do label ou input
          const label = group.querySelector('label') || group.querySelector('strong');
          if (label && !label.querySelector('.lock-icon')) {
            label.innerHTML += ' <span class="lock-icon">🔒</span>';
          }
          // Desabilitar inputs/checkboxes
          group.querySelectorAll('input, select').forEach(input => input.disabled = true);
        } else {
          group.classList.remove('locked-feature');
          group.title = '';
          const lockIcon = group.querySelector('.lock-icon');
          if (lockIcon) lockIcon.remove();
          group.querySelectorAll('input, select').forEach(input => input.disabled = false);
        }
      }
    });

    // 4. Ajustar o filtro de lucro de entrada para free (max 1%)
    const filterMinProfitEDisplayOptions = filterMinProfitEDisplayEl.options;
    for (let i = 0; i < filterMinProfitEDisplayOptions.length; i++) {
      const option = filterMinProfitEDisplayOptions[i];
      const value = parseFloat(option.value);
      if (isFreeUser) {
        if (value > 1.0) {
          option.disabled = true;
          option.classList.add('premium-option');
        } else {
          option.disabled = false;
          option.classList.remove('premium-option');
        }
      } else {
        option.disabled = false;
        option.classList.remove('premium-option');
      }
    }
    // Se o usuário free estiver com uma opção > 1% selecionada, resetar para 1%
    if (isFreeUser && parseFloat(filterMinProfitEDisplayEl.value) > 1.0) {
      filterMinProfitEDisplayEl.value = '1.0';
      state.filters.minProfitEFilterDisplay = 1.0;
      requestUiUpdate();
    }

    // 5. Ocultar oportunidades premium na tabela principal para usuários free (visual)
    document.querySelectorAll('.opportunity-row.premium-feature-row').forEach(row => {
      if (isFreeUser) {
        row.style.display = 'none';
      } else {
        row.style.display = '';
      }
    });
  }

  // Chama fetchUserData no carregamento da página
  fetchUserData();
});

// --- FUNÇÕES DE UTILIDADE (EXISTENTES) ---
function addEventListenersToButtons() {
  document.querySelectorAll('.favorite-button').forEach(button => {
    button.onclick = (e) => {
      e.stopPropagation();
      const pair = button.dataset.pair;
      const direction = button.dataset.direction;
      const key = `${pair}-${direction}`;
      const index = state.favoritedOps.indexOf(key);
      if (index > -1) {
        state.favoritedOps.splice(index, 1);
        button.classList.remove('favorited');
        button.querySelector('svg').setAttribute('fill', 'none');
      } else {
        state.favoritedOps.push(key);
        button.classList.add('favorited');
        button.querySelector('svg').setAttribute('fill', 'gold');
      }
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state.favoritedOps));
      requestUiUpdate();
    };
  });

  document.querySelectorAll('.block-button').forEach(button => {
    button.onclick = (e) => {
      e.stopPropagation();
      const pair = button.dataset.pair;
      const direction = button.dataset.direction;
      const key = `${pair}-${direction}`;
      const opToBlock = state.arbitrageOpportunities.find(opWrapper => `${opWrapper.data.pair}-${opWrapper.data.direction}` === key)?.data;

      if (opToBlock) {
        const isBlocked = state.blockedOps.some(blockedOp => blockedOp.key === key);
        if (isBlocked) {
          state.blockedOps = state.blockedOps.filter(blockedOp => blockedOp.key !== key);
          button.classList.remove('blocked');
          button.querySelector('svg').setAttribute('fill', 'none');
        } else {
          state.blockedOps.push({ ...opToBlock, key: key });
          button.classList.add('blocked');
          button.querySelector('svg').setAttribute('fill', 'red');
        }
        localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(state.blockedOps));
        requestUiUpdate();
      }
    };
  });

  document.querySelectorAll('.unblock-button').forEach(button => {
    button.onclick = (e) => {
      e.stopPropagation();
      const key = button.dataset.key;
      state.blockedOps = state.blockedOps.filter(blockedOp => blockedOp.key !== key);
      localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(state.blockedOps));
      requestUiUpdate();
    };
  });

  document.querySelectorAll('.calculator-button').forEach(button => {
    button.onclick = (e) => {
      e.stopPropagation();
      const pair = button.dataset.pair;
      const direction = button.dataset.direction;
      const buyEx = button.dataset.buyEx;
      const sellEx = button.dataset.sellEx;
      const opDataForCopyStr = button.dataset.opData; // Dados da oportunidade em string JSON
      abrirGraficosComLayout(buyEx, null, sellEx, null, pair, direction, opDataForCopyStr);
    };
  });

  document.querySelectorAll('.remove-watch-pair-button').forEach(button => {
    button.onclick = (e) => {
      e.stopPropagation();
      const pairToRemove = button.dataset.pair;
      state.watchedPairsList = state.watchedPairsList.filter(p => p !== pairToRemove);
      localStorage.setItem('arbitrageDashboard_watchedPairs_v1', JSON.stringify(state.watchedPairsList));
      requestUiUpdate();
    };
  });
}

// --- FUNÇÕES DE INICIALIZAÇÃO ---
// Esta função é chamada no final do DOMContentLoaded
// para garantir que todos os elementos estejam disponíveis.

