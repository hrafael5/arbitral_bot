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
  currentUserSubscriptionStatus: null
};

// --- INÍCIO DA INJEÇÃO DE DADOS DE DEMONSTRAÇÃO ---
state.arbitrageOpportunities = [
  {
    id: "DEMO_BTC_USDT_MEXC_GATEIO",
    data: {
      pair: "BTC/USDT",
      direction: "MEXC_SPOT/GATEIO_FUTURES",
      netSpreadPercentage: 0.85,
      buyExchange: "MEXC",
      buyInstrument: "SPOT",
      buyPrice: 60000.00,
      sellExchange: "GATEIO",
      sellInstrument: "FUTURES",
      sellPrice: 60510.00,
      spotVolume24hUSD: 100000000,
      futuresVolume24hUSD: 500000000,
      fundingRate: 0.0001,
      timestamp: Date.now()
    },
    lastUpdated: Date.now()
  }
];

state.allPairsData = [
  {
    pair: "BTC/USDT",
    exchange: "MEXC",
    spotPrice: 60000.00,
    futuresPrice: 60050.00,
    spotBid: 59990.00,
    futuresBid: 60040.00
  },
  {
    pair: "BTC/USDT",
    exchange: "GATEIO",
    spotPrice: 60400.00,
    futuresPrice: 60510.00,
    spotBid: 60390.00,
    futuresBid: 60500.00
  }
];

state.currentUserSubscriptionStatus = 'premium'; // Simula um usuário premium para habilitar todos os recursos
// --- FIM DA INJEÇÃO DE DADOS DE DEMONSTRAÇÃO ---

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
            "'": '&#39;'
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
    if (newWindow) {
        newWindow.focus();
    } else {
        alert('Pop-up bloqueado! Por favor, permita pop-ups para este site para abrir os gráficos.');
    }
}

function abrirCalculadora(pair, direction, buyEx, sellEx, forceNewWindow = false) {
    const url = `realtime_profit_calc.html?pair=${encodeURIComponent(pair)}&direction=${encodeURIComponent(direction)}&buyEx=${encodeURIComponent(buyEx)}&sellEx=${encodeURIComponent(sellEx)}`;
    const windowName = forceNewWindow ? 
'_blank' : 'arbitrage_calculator_window';
    const popWidth = 420;
    const popHeight = 220;
    const left = (window.screen.availWidth / 2) - (popWidth / 2);
    const top = (window.screen.availHeight / 2) - (popHeight / 2);
    const features = `width=${popWidth},height=${popHeight},top=${top},left=${left},resizable=yes,scrollbars=yes`;
    const calcWindow = window.open(url, windowName, features);
    if (calcWindow) {
        calcWindow.focus();
    } else {
        alert("Pop-up da calculadora bloqueado! Por favor, permita pop-ups para este site.");
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
        const op = opWrapper.data; // Corrigido: acessando op.data
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

        if (!state.config.arbitrage.enableFuturesVsFutures && isFutFut) return false;
        if (!state.config.arbitrage.enableSpotVsSpot && isSpotSpot) return false;

        // Filtro por volume
        if (op.spotVolume24hUSD < state.filters.minVolume && op.futuresVolume24hUSD < state.filters.minVolume) {
            return false;
        }

        // Filtro por Funding Rate
        if (state.filters.minFundingRate !== null && op.fundingRate < state.filters.minFundingRate) {
            return false;
        }
        if (state.filters.maxFundingRate !== null && op.fundingRate > state.filters.maxFundingRate) {
            return false;
        }

        // Filtros de exchange
        const buyExLower = op.buyExchange.toLowerCase();
        const sellExLower = op.sellExchange.toLowerCase();
        const buyInstLower = op.buyInstrument.toLowerCase();
        const sellInstLower = op.sellInstrument.toLowerCase();

        if (buyExLower === 'mexc' && buyInstLower === 'spot' && !state.filters.mexcSpot) return false;
        if (buyExLower === 'mexc' && buyInstLower === 'futures' && !state.filters.mexcFutures) return false;
        if (buyExLower === 'gateio' && buyInstLower === 'spot' && !state.filters.gateioSpot) return false;
        if (buyExLower === 'gateio' && buyInstLower === 'futures' && !state.filters.gateioFutures) return false;

        if (sellExLower === 'mexc' && sellInstLower === 'spot' && !state.filters.mexcSpot) return false;
        if (sellExLower === 'mexc' && sellInstLower === 'futures' && !state.filters.mexcFutures) return false;
        if (sellExLower === 'gateio' && sellInstLower === 'spot' && !state.filters.gateioSpot) return false;
        if (sellExLower === 'gateio' && sellInstLower === 'futures' && !state.filters.gateioFutures) return false;

        return true;
    });

    // Ordenação
    opportunities.sort((a, b) => {
        const valA = a.data[state.sortColumn];
        const valB = b.data[state.sortColumn];

        if (state.sortDirection === 'asc') {
            return valA - valB;
        } else {
            return valB - valA;
        }
    });

    return opportunities;
}

function calculateLucroS(op, allPairsData, config) {
    const sellExchange = op.sellExchange;
    const sellInstrument = op.sellInstrument;
    const sellPrice = op.sellPrice;
    const pair = op.pair;

    // Encontrar o preço de compra correspondente na mesma exchange de venda
    const matchingPairData = allPairsData.find(p => 
        p.pair === pair && 
        p.exchange === sellExchange && 
        ((sellInstrument === 'SPOT' && p.spotPrice !== undefined) || (sellInstrument === 'FUTURES' && p.futuresPrice !== undefined))
    );

    if (!matchingPairData) {
        return null; // Não foi possível encontrar dados correspondentes
    }

    let buyPriceOnSellExchange;
    if (sellInstrument === 'SPOT') {
        buyPriceOnSellExchange = matchingPairData.spotPrice;
    } else if (sellInstrument === 'FUTURES') {
        buyPriceOnSellExchange = matchingPairData.futuresPrice;
    } else {
        return null; // Instrumento desconhecido
    }

    if (!buyPriceOnSellExchange || buyPriceOnSellExchange === 0) {
        return null; // Preço de compra inválido
    }

    const fee = (sellInstrument === 'SPOT') ? config.exchanges[sellExchange.toLowerCase()].spotMakerFee : config.exchanges[sellExchange.toLowerCase()].futuresMakerFee;
    const profit = (buyPriceOnSellExchange - sellPrice) / sellPrice * 100 - fee * 100;
    return profit;
}

function formatPrice(price) {
    if (price === null || price === undefined) return 'N/A';
    return `$${price.toFixed(2)}`;
}

function formatPercentage(percentage) {
    if (percentage === null || percentage === undefined) return 'N/A';
    return `${percentage.toFixed(2)}%`;
}

function formatVolume(volume) {
    if (volume === null || volume === undefined) return 'N/A';
    if (volume >= 1000000) {
        return `$${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
        return `$${(volume / 1000).toFixed(1)}K`;
    } else {
        return `$${volume.toFixed(0)}`;
    }
}

function getExchangeTag(exchange) {
    const tags = {
        'MEXC': 'MEXC',
        'GATEIO': 'Gate.io',
        'BINANCE': 'Binance',
        'BYBIT': 'Bybit'
    };
    return tags[exchange.toUpperCase()] || exchange;
}

function renderOpportunitiesTable() {
    const filteredOpportunities = getFilteredOpportunities();
    let tableHtml = '';

    if (filteredOpportunities.length === 0) {
        tableHtml = `<tr><td colspan="10" class="no-opportunities">Nenhuma oportunidade encontrada. Ajuste seus filtros ou aguarde novas oportunidades.</td></tr>`;
    } else {
        filteredOpportunities.forEach(opWrapper => {
            const op = opWrapper.data;
            const escapedPair = escapeHTML(op.pair);
            const escapedDirection = escapeHTML(op.direction);
            const escapedBuyEx = escapeHTML(op.buyExchange);
            const escapedSellEx = escapeHTML(op.sellExchange);
            const escapedBuyInst = escapeHTML(op.buyInstrument);
            const escapedSellInst = escapeHTML(op.sellInstrument);
            const opDataForCopy = escapeHTML(JSON.stringify(op));

            const isFavorite = state.favoritedOps.includes(op.id);
            const favoriteIcon = isFavorite ? 
                `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="gold" stroke="gold" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="favorite-star" data-op-key="${op.id}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>` :
                `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="favorite-star" data-op-key="${op.id}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

            const blockIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="block-icon" data-op-key="${op.id}" data-op-data="${opDataForCopy}" title="Bloquear Oportunidade"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

            const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="copy-button" data-copy-value="${op.pair}" title="Copiar Par"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

            const openExchangeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="open-exchange-icon" data-buy-ex="${escapedBuyEx}" data-buy-inst="${escapedBuyInst}" data-sell-ex="${escapedSellEx}" data-sell-inst="${escapedSellInst}" data-pair="${escapedPair}" data-direction="${escapedDirection}" data-op-data="${opDataForCopy}" title="Abrir Gráficos e Calculadora"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

            const calculatorIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="calculator-icon" data-pair="${escapedPair}" data-direction="${escapedDirection}" data-buy-ex="${escapedBuyEx}" data-sell-ex="${escapedSellEx}" title="Abrir Calculadora Detalhada em nova janela"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="14" x2="16" y2="18"></line><line x1="16" y1="10" x2="16" y2="10"></line><line x1="12" y1="10" x2="12" y2="10"></line><line x1="8" y1="10" x2="8" y2="10"></line><line x1="12" y1="14" x2="12" y2="18"></line><line x1="8" y1="14" x2="8" y2="18"></line></svg>`;

            const compraLink = `<a href="#" class="exchange-link" data-exchange="${escapedBuyEx}" data-instrument="${escapedBuyInst}" data-pair="${escapedPair}">${getExchangeTag(op.buyExchange)} ${op.buyInstrument}<span>${formatPrice(op.buyPrice)}</span></a>`;
            const vendaLink = `<a href="#" class="exchange-link" data-exchange="${escapedSellEx}" data-instrument="${escapedSellInst}" data-pair="${escapedPair}">${getExchangeTag(op.sellExchange)} ${op.sellInstrument}<span>${formatPrice(op.sellPrice)}</span></a>`;

            tableHtml += `<tr>
                <td class="pair-cell">${favoriteIcon} ${blockIcon} ${escapedPair} ${copyIcon}</td>
                <td>${escapedDirection}</td>
                <td>${formatPercentage(op.netSpreadPercentage)}</td>
                <td>${compraLink}</td>
                <td>${vendaLink}</td>
                <td>${formatVolume(op.spotVolume24hUSD)}</td>
                <td>${formatVolume(op.futuresVolume24hUSD)}</td>
                <td>${formatPercentage(op.fundingRate * 100)}</td>
                <td>${openExchangeIcon} ${calculatorIcon}</td>
            </tr>`;
        });
    }

    opportunitiesTableBodyEl.innerHTML = tableHtml;
    // addTableEventListeners(); // Não é mais necessário chamar aqui devido à delegação de eventos
    updateMainTitle();
}

function renderWatchedPairsTable() {
    const watchedPairs = state.arbitrageOpportunities.filter(opWrapper => state.watchedPairsList.includes(opWrapper.data.pair));
    let tableHtml = '';

    if (watchedPairs.length === 0) {
        tableHtml = `<tr><td colspan="6" class="no-opportunities">Nenhum par em vigilância.</td></tr>`;
    } else {
        watchedPairs.forEach(opWrapper => {
            const op = opWrapper.data;
            const escapedPair = escapeHTML(op.pair);
            const escapedDirection = escapeHTML(op.direction);
            const escapedBuyEx = escapeHTML(op.buyExchange);
            const escapedSellEx = escapeHTML(op.sellExchange);
            const escapedBuyInst = escapeHTML(op.buyInstrument);
            const escapedSellInst = escapeHTML(op.sellInstrument);
            const opDataForCopy = escapeHTML(JSON.stringify(op));

            const removeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="remove-watch-icon" data-pair="${escapedPair}" title="Remover da Vigilância"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

            const openExchangeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="open-exchange-icon" data-buy-ex="${escapedBuyEx}" data-buy-inst="${escapedBuyInst}" data-sell-ex="${escapedSellEx}" data-sell-inst="${escapedSellInst}" data-pair="${escapedPair}" data-direction="${escapedDirection}" data-op-data="${opDataForCopy}" title="Abrir Gráficos e Calculadora"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

            const calculatorIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="calculator-icon" data-pair="${escapedPair}" data-direction="${escapedDirection}" data-buy-ex="${escapedBuyEx}" data-sell-ex="${escapedSellEx}" title="Abrir Calculadora Detalhada em nova janela"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="14" x2="16" y2="18"></line><line x1="16" y1="10" x2="16" y2="10"></line><line x1="12" y1="10" x2="12" y2="10"></line><line x1="8" y1="10" x2="8" y2="10"></line><line x1="12" y1="14" x2="12" y2="18"></line><line x1="8" y1="14" x2="8" y2="18"></line></svg>`;

            tableHtml += `<tr>
                <td>${escapedPair}</td>
                <td>${formatPercentage(op.netSpreadPercentage)}</td>
                <td>${getExchangeTag(op.buyExchange)} ${op.buyInstrument}</td>
                <td>${getExchangeTag(op.sellExchange)} ${op.sellInstrument}</td>
                <td>${openExchangeIcon} ${calculatorIcon}</td>
                <td>${removeIcon}</td>
            </tr>`;
        });
    }
    document.getElementById("watched-pairs-table-body").innerHTML = tableHtml;
    watchedPairsCountEl.textContent = `(${watchedPairs.length})`;
    // addTableEventListeners(); // Não é mais necessário chamar aqui devido à delegação de eventos
}

function renderBlockedOpsTable() {
    let tableHtml = '';
    if (state.blockedOps.length === 0) {
        tableHtml = `<tr><td colspan="3" class="no-opportunities">Nenhuma oportunidade bloqueada.</td></tr>`;
    } else {
        state.blockedOps.forEach(blockedOp => {
            const op = blockedOp.data;
            const escapedPair = escapeHTML(op.pair);
            const escapedDirection = escapeHTML(op.direction);
            const unblockIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="unblock-icon" data-op-key="${blockedOp.key}" title="Desbloquear Oportunidade"><path d="M11 11H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V13a2 2 0 0 0-2-2z"></path><path d="M16 11V7a4 4 0 0 0-8 0v4"></path></svg>`;
            tableHtml += `<tr>
                <td>${escapedPair}</td>
                <td>${escapedDirection}</td>
                <td>${unblockIcon}</td>
            </tr>`;
        });
    }
    blockedOpsTableBodyEl.innerHTML = tableHtml;
    blockedOpsCountEl.textContent = `(${state.blockedOps.length})`;
    // addTableEventListeners(); // Não é mais necessário chamar aqui devido à delegação de eventos
}

function renderPairsTable() {
    let tableHtml = '';
    if (state.allPairsData.length === 0) {
        tableHtml = `<tr><td colspan="5" class="no-pairs">Nenhum par monitorado.</td></tr>`;
    } else {
        state.allPairsData.forEach(pairData => {
            const escapedPair = escapeHTML(pairData.pair);
            const escapedExchange = escapeHTML(pairData.exchange);
            tableHtml += `<tr>
                <td>${escapedPair}</td>
                <td>${escapedExchange}</td>
                <td>${formatPrice(pairData.spotPrice)}</td>
                <td>${formatPrice(pairData.futuresPrice)}</td>
                <td>${formatPrice(pairData.spotBid)}</td>
            </tr>`;
        });
    }
    pairsTableBodyEl.innerHTML = tableHtml;
    pairCountMonitorEl.textContent = `(${state.allPairsData.length})`;
}

function updateConnectionStatus() {
    if (state.connected) {
        elements.connectionDot.style.backgroundColor = 'green';
        elements.connectionText.textContent = 'Conectado';
    } else {
        elements.connectionDot.style.backgroundColor = 'red';
        elements.connectionText.textContent = 'Desconectado';
    }
}

function updateLastUpdated() {
    if (state.lastUpdated) {
        const now = Date.now();
        const diffSeconds = Math.floor((now - state.lastUpdated) / 1000);
        elements.lastUpdated.textContent = `Última atualização: ${diffSeconds}s atrás`;
    } else {
        elements.lastUpdated.textContent = 'Última atualização: N/A';
    }
}

function updateDefaultCapitalDisplay() {
    defaultCapitalInputEl.value = state.defaultCapitalUSD;
    qtySugBaseUnitHeaderEl.textContent = `Qtd Sugerida (${state.defaultCapitalUSD > 0 ? 'USD' : 'N/A'})`;
}

function updateFilterDisplay() {
    filterMinVolumeInput.value = state.filters.minVolume;
    filterMinProfitEDisplayEl.value = state.filters.minProfitEFilterDisplay;
    filterMinProfitSDisplayEl.value = state.filters.minProfitSFilterDisplay;
    filterEnableFutFutEl.checked = state.config.arbitrage.enableFuturesVsFutures;
    filterEnableSpotSpotEl.checked = state.config.arbitrage.enableSpotVsSpot;
    soundProfitThresholdInputEl.value = state.soundProfitThreshold;
    filterFundingMinInput.value = state.filters.minFundingRate !== null ? state.filters.minFundingRate : '';
    filterFundingMaxInput.value = state.filters.maxFundingRate !== null ? state.filters.maxFundingRate : '';

    for (const key in filterCheckboxes) {
        if (filterCheckboxes.hasOwnProperty(key)) {
            filterCheckboxes[key].checked = state.filters[key];
        }
    }
}

function updateSoundButton() {
    if (state.soundEnabled) {
        elements.soundOnIcon.style.display = 'block';
        elements.soundOffIcon.style.display = 'none';
    } else {
        elements.soundOnIcon.style.display = 'none';
        elements.soundOffIcon.style.display = 'block';
    }
}

function updateThemeButton() {
    if (state.isDarkTheme) {
        elements.sunIcon.style.display = 'block';
        elements.moonIcon.style.display = 'none';
    } else {
        elements.sunIcon.style.display = 'none';
        elements.moonIcon.style.display = 'block';
    }
}

function updatePauseButton() {
    if (state.isPaused) {
        elements.pauseIcon.style.display = 'block';
        elements.playIcon.style.display = 'none';
    } else {
        elements.pauseIcon.style.display = 'none';
        elements.playIcon.style.display = 'block';
    }
}

function updateWatchedPairsSection() {
    if (state.isWatchedPairsExpanded) {
        watchedPairsTableContainerEl.style.display = 'block';
        watchedPairsToggleIconEl.innerHTML = ICON_EXPANDED;
    } else {
        watchedPairsTableContainerEl.style.display = 'none';
        watchedPairsToggleIconEl.innerHTML = ICON_COLLAPSED;
    }
}

function updateMonitorParesSection() {
    if (state.isMonitorParesExpanded) {
        monitorParesTableContainerEl.style.display = 'block';
        monitorParesToggleIconEl.innerHTML = ICON_EXPANDED;
    } else {
        monitorParesTableContainerEl.style.display = 'none';
        monitorParesToggleIconEl.innerHTML = ICON_COLLAPSED;
    }
}

function requestUiUpdate() {
    if (!uiUpdateScheduled) {
        uiUpdateScheduled = true;
        setTimeout(() => {
            renderOpportunitiesTable();
            renderWatchedPairsTable();
            renderBlockedOpsTable();
            renderPairsTable();
            updateConnectionStatus();
            updateLastUpdated();
            updateDefaultCapitalDisplay();
            updateFilterDisplay();
            updateSoundButton();
            updateThemeButton();
            updatePauseButton();
            updateWatchedPairsSection();
            updateMonitorParesSection();
            uiUpdateScheduled = false;
        }, UI_UPDATE_INTERVAL_MS);
    }
}

function sortByColumn(column) {
    if (state.sortColumn === column) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortColumn = column;
        state.sortDirection = 'desc';
    }
    requestUiUpdate();
}

function toggleFavorite(opId) {
    const index = state.favoritedOps.indexOf(opId);
    if (index > -1) {
        state.favoritedOps.splice(index, 1);
    } else {
        state.favoritedOps.push(opId);
    }
    saveFavorites();
    requestUiUpdate();
}

function toggleBlock(opKey, opDataStr) {
    const index = state.blockedOps.findIndex(op => op.key === opKey);
    if (index > -1) {
        state.blockedOps.splice(index, 1);
    } else {
        try {
            const opData = JSON.parse(opDataStr);
            state.blockedOps.push({ key: opKey, data: opData });
        } catch (e) {
            console.error("FRONTEND: Erro ao parsear opData para bloquear", e);
        }
    }
    saveBlockedOps();
    requestUiUpdate();
}

function removeWatchedPair(pair) {
    state.watchedPairsList = state.watchedPairsList.filter(p => p !== pair);
    saveWatchedPairs();
    requestUiUpdate();
}

function addWatchedPair(pair) {
    if (pair && !state.watchedPairsList.includes(pair)) {
        state.watchedPairsList.push(pair);
        saveWatchedPairs();
        requestUiUpdate();
    }
}

function saveFavorites() {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state.favoritedOps));
}

function loadFavorites() {
    const savedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (savedFavorites) {
        state.favoritedOps = JSON.parse(savedFavorites);
    }
}

function saveBlockedOps() {
    localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(state.blockedOps));
}

function loadBlockedOps() {
    const savedBlockedOps = localStorage.getItem(BLOCKED_STORAGE_KEY);
    if (savedBlockedOps) {
        state.blockedOps = JSON.parse(savedBlockedOps);
    }
}

function saveWatchedPairs() {
    localStorage.setItem("watchedPairs", JSON.stringify(state.watchedPairsList));
}

function loadWatchedPairs() {
    const savedWatchedPairs = localStorage.getItem("watchedPairs");
    if (savedWatchedPairs) {
        state.watchedPairsList = JSON.parse(savedWatchedPairs);
    }
}

function saveHiddenWatchedOps() {
    localStorage.setItem(HIDDEN_WATCHED_OPS_STORAGE_KEY, JSON.stringify(Array.from(state.hiddenWatchedOps)));
}

function loadHiddenWatchedOps() {
    const savedHidden = localStorage.getItem(HIDDEN_WATCHED_OPS_STORAGE_KEY);
    if (savedHidden) {
        state.hiddenWatchedOps = new Set(JSON.parse(savedHidden));
    }
}

function saveDefaultCapital() {
    localStorage.setItem(DEFAULT_CAPITAL_STORAGE_KEY, state.defaultCapitalUSD);
}

function loadDefaultCapital() {
    const savedCapital = localStorage.getItem(DEFAULT_CAPITAL_STORAGE_KEY);
    if (savedCapital !== null) {
        state.defaultCapitalUSD = parseFloat(savedCapital);
    }
}

function saveMonitorParesExpandedState() {
    localStorage.setItem(MONITOR_PARES_EXPANDED_KEY, state.isMonitorParesExpanded);
}

function loadMonitorParesExpandedState() {
    const savedState = localStorage.getItem(MONITOR_PARES_EXPANDED_KEY);
    if (savedState !== null) {
        state.isMonitorParesExpanded = (savedState === 'true');
    }
}

function saveWatchedPairsExpandedState() {
    localStorage.setItem(WATCHED_PAIRS_EXPANDED_KEY, state.isWatchedPairsExpanded);
}

function loadWatchedPairsExpandedState() {
    const savedState = localStorage.getItem(WATCHED_PAIRS_EXPANDED_KEY);
    if (savedState !== null) {
        state.isWatchedPairsExpanded = (savedState === 'true');
    }
}

function saveThemePreference() {
    localStorage.setItem(THEME_STORAGE_KEY, state.isDarkTheme ? 'dark' : 'light');
}

function loadThemePreference() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark') {
        state.isDarkTheme = true;
        document.body.classList.add('dark-theme');
    } else {
        state.isDarkTheme = false;
        document.body.classList.remove('dark-theme');
    }
}

function showUpgradeAlert() {
    alert("Funcionalidade disponível apenas para assinantes Premium. Faça upgrade para desbloquear!");
}

// --- WEBSOCKET E ATUALIZAÇÕES DE DADOS ---
function connectWebSocket() {
    ws = new WebSocket("ws://localhost:8080"); // Altere para o endereço do seu backend

    ws.onopen = () => {
        console.log("FRONTEND: Conectado ao WebSocket");
        state.connected = true;
        requestUiUpdate();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'initial_data' || data.type === 'update') {
            state.allPairsData = data.allPairsData;
            state.arbitrageOpportunities = data.arbitrageOpportunities;
            state.lastUpdated = Date.now();
            state.connected = true;
            requestUiUpdate();
            playArbitrageSound(data.arbitrageOpportunities);
        } else if (data.type === 'config_update') {
            state.config = { ...state.config, ...data.config };
            requestUiUpdate();
        } else if (data.type === 'status_update') {
            state.connected = data.connected;
            requestUiUpdate();
        }
    };

    ws.onclose = () => {
        console.log("FRONTEND: Desconectado do WebSocket. Tentando reconectar em 5s...");
        state.connected = false;
        requestUiUpdate();
        setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (error) => {
        console.error("FRONTEND: Erro no WebSocket:", error);
        ws.close();
    };
}

function playArbitrageSound(currentOpportunities) {
    if (!state.soundEnabled || !state.soundPermissionGranted) return;

    const newOpportunities = currentOpportunities.filter(op => 
        op.data.netSpreadPercentage >= state.soundProfitThreshold && 
        !state.soundPlayedForVisibleOps.has(op.id)
    );

    if (newOpportunities.length > 0) {
        const audio = new Audio('arbitrage_alert.mp3'); // Certifique-se de ter este arquivo
        audio.play().then(() => {
            newOpportunities.forEach(op => state.soundPlayedForVisibleOps.add(op.id));
        }).catch(error => {
            console.warn("FRONTEND: Falha ao tocar som (pode ser restrição do navegador):", error);
            // Se o som não puder ser tocado automaticamente, peça permissão
            if (error.name === 'NotAllowedError') {
                alert("Por favor, clique em qualquer lugar na página para permitir a reprodução automática de áudio.");
                state.soundPermissionGranted = false; // Resetar para pedir novamente
            }
        });
    }
}

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    loadFavorites();
    loadBlockedOps();
    loadWatchedPairs();
    loadHiddenWatchedOps();
    loadDefaultCapital();
    loadMonitorParesExpandedState();
    loadWatchedPairsExpandedState();
    loadThemePreference();

    // Event Listeners para elementos estáticos
    elements.sidebarToggle.addEventListener('click', toggleSidebar);
    elements.navArbitragens.addEventListener('click', () => setCurrentView('arbitragens'));
    elements.navSaidaOp.addEventListener('click', () => setCurrentView('saida-op'));
    elements.navAmbosPositivos.addEventListener('click', () => setCurrentView('ambos-positivos'));
    elements.toggleBlockedOps.addEventListener('click', toggleBlockedOps);
    elements.toggleSoundButton.addEventListener('click', () => {
        if (!state.soundPermissionGranted) {
            // Tenta tocar um som mudo para obter permissão
            const audio = new Audio();
            audio.play().then(() => {
                state.soundPermissionGranted = true;
                state.soundEnabled = !state.soundEnabled;
                updateSoundButton();
            }).catch(error => {
                alert("Para habilitar o som, por favor, interaja com a página primeiro (clique em qualquer lugar).");
                console.warn("FRONTEND: Permissão de áudio não concedida automaticamente:", error);
            });
        } else {
            state.soundEnabled = !state.soundEnabled;
            updateSoundButton();
        }
    });
    elements.themeToggleButton.addEventListener('click', () => {
        state.isDarkTheme = !state.isDarkTheme;
        document.body.classList.toggle('dark-theme', state.isDarkTheme);
        saveThemePreference();
        updateThemeButton();
    });
    elements.togglePauseButton.addEventListener('click', () => {
        state.isPaused = !state.isPaused;
        updatePauseButton();
        // Lógica para pausar/retomar o WebSocket ou o processamento de dados
    });

    defaultCapitalInputEl.addEventListener('change', (e) => {
        state.defaultCapitalUSD = parseFloat(e.target.value) || 0;
        saveDefaultCapital();
        requestUiUpdate();
    });

    filterMinVolumeInput.addEventListener('input', (e) => {
        state.filters.minVolume = parseFloat(e.target.value) || 0;
        requestUiUpdate();
    });

    filterMinProfitEDisplayEl.addEventListener('input', (e) => {
        state.filters.minProfitEFilterDisplay = parseFloat(e.target.value) || 0;
        requestUiUpdate();
    });

    filterMinProfitSDisplayEl.addEventListener('input', (e) => {
        state.filters.minProfitSFilterDisplay = parseFloat(e.target.value) || 0;
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

    soundProfitThresholdInputEl.addEventListener('input', (e) => {
        state.soundProfitThreshold = parseFloat(e.target.value) || 0;
        requestUiUpdate();
    });

    watchPairInputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addWatchedPair(e.target.value.toUpperCase());
            e.target.value = '';
        }
    });

    addWatchPairButtonEl.addEventListener('click', () => {
        addWatchedPair(watchPairInputEl.value.toUpperCase());
        watchPairInputEl.value = '';
    });

    watchedPairsHeaderEl.addEventListener('click', () => {
        state.isWatchedPairsExpanded = !state.isWatchedPairsExpanded;
        saveWatchedPairsExpandedState();
        updateWatchedPairsSection();
    });

    monitorParesHeaderEl.addEventListener('click', () => {
        state.isMonitorParesExpanded = !state.isMonitorParesExpanded;
        saveMonitorParesExpandedState();
        updateMonitorParesSection();
    });

    filterFundingMinInput.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        state.filters.minFundingRate = isNaN(value) ? null : value;
        requestUiUpdate();
    });

    filterFundingMaxInput.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        state.filters.maxFundingRate = isNaN(value) ? null : value;
        requestUiUpdate();
    });

    // Event listeners para os checkboxes de filtro de exchange
    for (const key in filterCheckboxes) {
        if (filterCheckboxes.hasOwnProperty(key)) {
            filterCheckboxes[key].addEventListener('change', (e) => {
                state.filters[key] = e.target.checked;
                requestUiUpdate();
            });
        }
    }

    // Event listeners para elementos que são renderizados dinamicamente
    // Estes são adicionados após cada renderização da tabela
    document.getElementById("opportunities-table-body").addEventListener('click', (event) => {
        const target = event.target.closest('.copy-button, .open-exchange-icon, .exchange-link, .calculator-icon, .favorite-star, .block-icon');
        if (!target) return;

        if (target.classList.contains('copy-button')) {
            copiarParaClipboard(target.dataset.copyValue, target);
        } else if (target.classList.contains('open-exchange-icon')) {
            const buyEx = target.dataset.buyEx;
            const buyInst = target.dataset.buyInst;
            const sellEx = target.dataset.sellEx;
            const sellInst = target.dataset.sellInst;
            const pair = target.dataset.pair;
            const direction = target.dataset.direction;
            const opData = target.dataset.opData;
            abrirGraficosComLayout(buyEx, buyInst, sellEx, sellInst, pair, direction, opData);
        } else if (target.classList.contains('exchange-link')) {
            event.preventDefault();
            const exchange = target.dataset.exchange;
            const instrument = target.dataset.instrument;
            const pair = target.dataset.pair;
            window.open(getExchangeUrl(exchange, instrument, pair), '_blank');
        } else if (target.classList.contains('calculator-icon')) {
            const pair = target.dataset.pair;
            const direction = target.dataset.direction;
            const buyEx = target.dataset.buyEx;
            const sellEx = target.dataset.sellEx;
            abrirCalculadora(pair, direction, buyEx, sellEx, true);
        } else if (target.classList.contains('favorite-star')) {
            toggleFavorite(target.dataset.opKey);
        } else if (target.classList.contains('block-icon')) {
            toggleBlock(target.dataset.opKey, target.dataset.opData);
        }
    });

    document.getElementById("watched-pairs-table-body").addEventListener('click', (event) => {
        const target = event.target.closest('.remove-watch-icon, .open-exchange-icon, .calculator-icon');
        if (!target) return;

        if (target.classList.contains('remove-watch-icon')) {
            removeWatchedPair(target.dataset.pair);
        } else if (target.classList.contains('open-exchange-icon')) {
            const buyEx = target.dataset.buyEx;
            const buyInst = target.dataset.buyInst;
            const sellEx = target.dataset.sellEx;
            const sellInst = target.dataset.sellInst;
            const pair = target.dataset.pair;
            const direction = target.dataset.direction;
            const opData = target.dataset.opData;
            abrirGraficosComLayout(buyEx, buyInst, sellEx, sellInst, pair, direction, opData);
        } else if (target.classList.contains('calculator-icon')) {
            const pair = target.dataset.pair;
            const direction = target.dataset.direction;
            const buyEx = target.dataset.buyEx;
            const sellEx = target.dataset.sellEx;
            abrirCalculadora(pair, direction, buyEx, sellEx, true);
        }
    });

    document.getElementById("blocked-ops-table-body").addEventListener('click', (event) => {
        const target = event.target.closest('.unblock-icon');
        if (!target) return;

        if (target.classList.contains('unblock-icon')) {
            toggleBlock(target.dataset.opKey);
        }
    });

    // Inicialização da UI
    setCurrentView(state.currentView);
    updateDefaultCapitalDisplay();
    updateFilterDisplay();
    updateSoundButton();
    updateThemeButton();
    updatePauseButton();
    updateWatchedPairsSection();
    updateMonitorParesSection();
    requestUiUpdate();

    // Conectar ao WebSocket
    connectWebSocket();
});

// Função para adicionar event listeners após renderização da tabela
// Esta função não é mais necessária para os elementos que usam delegação de eventos
// Mas pode ser útil para elementos que são criados fora do fluxo de delegação
function addTableEventListeners() {
    // Event listeners para cabeçalhos de ordenação
    document.querySelectorAll('th.sortable').forEach(header => {
        header.removeEventListener('click', handleSortClick); // Remove o antigo se existir
        header.addEventListener('click', handleSortClick);
    });
}

function handleSortClick(event) {
    const column = this.dataset.column;
    if (column) {
        sortByColumn(column);
    }
}

// Função para remover event listeners de ordenação inline (já feito na inicialização)
function removeSortInlineHandlers() {
    document.querySelectorAll('th.sortable').forEach(header => {
        header.removeAttribute('onclick');
    });
}

// Função para inicializar event listeners (chamada uma vez no DOMContentLoaded)
function initializeEventListeners() {
    // Remover handlers inline de ordenação
    removeSortInlineHandlers();
    
    // Adicionar event listeners para ordenação
    addSortEventListeners();
}

// Chamada inicial para configurar os event listeners de ordenação
initializeEventListeners();


