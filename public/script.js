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
  // Aplicar restrições para usuários free apenas se o status já foi carregado
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

        // Aplicar restrições para usuários free apenas se o status já foi carregado
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

        if (!buyAllowed || !sellAllowed) return false;

        if (state.filters.minFundingRate !== null && op.fundingRate < state.filters.minFundingRate) return false;
        if (state.filters.maxFundingRate !== null && op.fundingRate > state.filters.maxFundingRate) return false;

        return true;
    });

    return opportunities;
}

function getVolumeForFiltering(op) {
    return Math.min(op.buyVolumeUSD || 0, op.sellVolumeUSD || 0);
}

function calculateLucroS(op, allPairsData, config) {
    const pairData = allPairsData.find(p => p.pair === op.pair && p.exchange.toLowerCase() === op.buyExchange.toLowerCase());
    if (!pairData) return null;

    const spotBid = pairData.spotBid;
    const futuresAsk = pairData.futuresAsk;
    if (spotBid === undefined || futuresAsk === undefined) return null;

    const spotFee = config.exchanges[op.buyExchange.toLowerCase()]?.spotMakerFee || 0;
    const futuresFee = config.exchanges[op.buyExchange.toLowerCase()]?.futuresMakerFee || 0;

    const sellPriceAfterFee = spotBid * (1 - spotFee);
    const buyPriceAfterFee = futuresAsk * (1 + futuresFee);

    if (buyPriceAfterFee <= 0) return null;

    const lucroS = ((sellPriceAfterFee - buyPriceAfterFee) / buyPriceAfterFee) * 100;
    return lucroS;
}

function sortByColumn(column) {
    if (state.sortColumn === column) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortColumn = column;
        state.sortDirection = 'desc';
    }
    updateSortArrows();
    requestUiUpdate();
}

function updateSortArrows() {
    document.querySelectorAll('.sort-arrow').forEach(arrow => {
        arrow.textContent = '';
    });
    const currentArrow = document.getElementById(`sort-arrow-${state.sortColumn}`);
    if (currentArrow) {
        currentArrow.textContent = state.sortDirection === 'asc' ? '↑' : '↓';
    }
}

function updateOpportunitiesTable() {
    const filteredOpportunities = getFilteredOpportunities();
    const sortedOpportunities = filteredOpportunities.sort((a, b) => {
        const valA = a.data[state.sortColumn];
        const valB = b.data[state.sortColumn];

        if (typeof valA === 'string') return state.sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return state.sortDirection === 'asc' ? valA - valB : valB - valA;
    });

    opportunitiesTableBodyEl.innerHTML = '';
    if (sortedOpportunities.length === 0) {
        opportunitiesTableBodyEl.innerHTML = '<tr><td colspan="10" class="no-data">Nenhuma oportunidade de arbitragem.</td></tr>';
        return;
    }

    sortedOpportunities.slice(0, state.maxOpportunitiesToShow).forEach(opWrapper => {
        const op = opWrapper.data;
        const row = opportunitiesTableBodyEl.insertRow();
        row.classList.add('opportunity-row');
        if (op.netSpreadPercentage >= state.soundProfitThreshold && state.soundEnabled && !state.soundPlayedForVisibleOps.has(op.pair)) {
            // playSoundAlert();
            state.soundPlayedForVisibleOps.add(op.pair);
        }

        row.innerHTML = `
            <td>
                <button class="favorite-button ${state.favoritedOps.includes(op.pair) ? 'favorited' : ''}" data-pair="${escapeHTML(op.pair)}">
                    ${state.favoritedOps.includes(op.pair) ? '★' : '☆'}
                </button>
                <a href="#" class="pair-link" data-pair="${escapeHTML(op.pair)}" data-buy-exchange="${escapeHTML(op.buyExchange)}" data-sell-exchange="${escapeHTML(op.sellExchange)}" data-buy-instrument="${escapeHTML(op.buyInstrument)}" data-sell-instrument="${escapeHTML(op.sellInstrument)}" data-direction="${escapeHTML(op.direction)}" data-op-data='${escapeHTML(JSON.stringify(op))}'>
                    ${escapeHTML(op.pair)}
                </a>
            </td>
            <td>${escapeHTML(op.buyExchange)} ${escapeHTML(op.buyInstrument)} ${op.buyPrice !== undefined ? op.buyPrice.toFixed(op.pricePrecision) : 'N/A'}</td>
            <td>${escapeHTML(op.sellExchange)} ${escapeHTML(op.sellInstrument)} ${op.sellPrice !== undefined ? op.sellPrice.toFixed(op.pricePrecision) : 'N/A'}</td>
            <td class="${op.netSpreadPercentage > 0 ? 'positive' : 'negative'}">${op.netSpreadPercentage !== undefined ? op.netSpreadPercentage.toFixed(2) : 'N/A'}%</td>
            <td class="${op.lucroS > 0 ? 'positive' : 'negative'}">${op.lucroS !== undefined ? op.lucroS.toFixed(2) : 'N/A'}%</td>
            <td>${op.buyVolumeUSD !== undefined ? op.buyVolumeUSD.toFixed(0) : 'N/A'} / ${op.sellVolumeUSD !== undefined ? op.sellVolumeUSD.toFixed(0) : 'N/A'}</td>
            <td class="${op.fundingRate > 0 ? 'positive' : 'negative'}">${op.fundingRate !== undefined ? op.fundingRate.toFixed(3) : 'N/A'}%</td>
            <td>${arredondarQuantidadeSugerida(op.suggestedQuantity)}</td>
            <td>${op.firstSeen ? formatTime(op.firstSeen) : 'N/A'}</td>
            <td>
                <button class="calculator-button" data-pair="${escapeHTML(op.pair)}" data-direction="${escapeHTML(op.direction)}" data-buy-ex="${escapeHTML(op.buyExchange)}" data-sell-ex="${escapeHTML(op.sellExchange)}">Calc</button>
            </td>
        `;
    });

    updateMainTitle();
}

function updateBlockedOpportunitiesTable() {
    blockedOpsTableBodyEl.innerHTML = '';
    if (state.blockedOps.length === 0) {
        blockedOpsTableBodyEl.innerHTML = '<tr><td colspan="8" class="no-data">Nenhuma oportunidade bloqueada.</td></tr>';
        return;
    }

    state.blockedOps.forEach(blockedOp => {
        const op = blockedOp.op;
        const row = blockedOpsTableBodyEl.insertRow();
        row.classList.add('blocked-opportunity-row');

        row.innerHTML = `
            <td>${escapeHTML(op.pair)}</td>
            <td>${escapeHTML(op.buyExchange)} ${escapeHTML(op.buyInstrument)} ${op.buyPrice !== undefined ? op.buyPrice.toFixed(op.pricePrecision) : 'N/A'}</td>
            <td>${escapeHTML(op.sellExchange)} ${escapeHTML(op.sellInstrument)} ${op.sellPrice !== undefined ? op.sellPrice.toFixed(op.pricePrecision) : 'N/A'}</td>
            <td class="${op.netSpreadPercentage > 0 ? 'positive' : 'negative'}">${op.netSpreadPercentage !== undefined ? op.netSpreadPercentage.toFixed(2) : 'N/A'}%</td>
            <td class="${op.lucroS > 0 ? 'positive' : 'negative'}">${op.lucroS !== undefined ? op.lucroS.toFixed(2) : 'N/A'}%</td>
            <td>${op.buyVolumeUSD !== undefined ? op.buyVolumeUSD.toFixed(0) : 'N/A'} / ${op.sellVolumeUSD !== undefined ? op.sellVolumeUSD.toFixed(0) : 'N/A'}</td>
            <td class="${op.fundingRate > 0 ? 'positive' : 'negative'}">${op.fundingRate !== undefined ? op.fundingRate.toFixed(3) : 'N/A'}%</td>
            <td>
                <button class="unblock-button" data-key="${escapeHTML(blockedOp.key)}">Desbloquear</button>
            </td>
        `;
    });
}

function updatePairsTable() {
    pairsTableBodyEl.innerHTML = '';
    if (state.allPairsData.length === 0) {
        pairsTableBodyEl.innerHTML = '<tr><td colspan="8" class="no-data">Aguardando dados dos pares... (Clique no cabeçalho acima para expandir)</td></tr>';
        return;
    }

    pairCountMonitorEl.textContent = state.allPairsData.length;

    state.allPairsData.forEach(pairData => {
        const row = pairsTableBodyEl.insertRow();
        row.innerHTML = `
            <td>${escapeHTML(pairData.exchange)}</td>
            <td>${escapeHTML(pairData.pair)}</td>
            <td>${pairData.spotAsk !== undefined ? pairData.spotAsk.toFixed(pairData.pricePrecision) : 'N/A'}</td>
            <td>${pairData.futuresAsk !== undefined ? pairData.futuresAsk.toFixed(pairData.pricePrecision) : 'N/A'}</td>
            <td>${pairData.spotBid !== undefined ? pairData.spotBid.toFixed(pairData.pricePrecision) : 'N/A'}</td>
            <td>${pairData.futuresBid !== undefined ? pairData.futuresBid.toFixed(pairData.pricePrecision) : 'N/A'}</td>
            <td>${pairData.spotTimestamp ? formatTime(pairData.spotTimestamp) : 'N/A'}</td>
            <td>${pairData.futuresTimestamp ? formatTime(pairData.futuresTimestamp) : 'N/A'}</td>
        `;
    });
}

function requestUiUpdate() {
    if (!uiUpdateScheduled) {
        uiUpdateScheduled = true;
        setTimeout(() => {
            updateOpportunitiesTable();
            updateBlockedOpportunitiesTable();
            updatePairsTable();
            uiUpdateScheduled = false;
        }, UI_UPDATE_INTERVAL_MS);
    }
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function updateConnectionStatus() {
    if (state.connected) {
        elements.connectionDot.classList.remove('disconnected');
        elements.connectionDot.classList.add('connected');
        elements.connectionText.textContent = 'Conectado';
    } else {
        elements.connectionDot.classList.remove('connected');
        elements.connectionDot.classList.add('disconnected');
        elements.connectionText.textContent = 'Desconectado';
    }
    elements.lastUpdated.textContent = state.lastUpdated ? `Última atualização: ${formatTime(state.lastUpdated)}` : 'Última atualização: --:--:--';
}

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return; // Já conectado ou conectando
    }

    // Usar wss:// se a página for HTTPS, caso contrário, ws://
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(`${protocol}${window.location.host}`);

    ws.onopen = () => {
        console.log('WebSocket conectado');
        state.connected = true;
        updateConnectionStatus();
        // Enviar mensagem de autenticação ou inicialização se necessário
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'opportunities') {
            state.arbitrageOpportunities = data.opportunities;
            state.allPairsData = data.allPairsData;
            state.lastUpdated = Date.now();
            requestUiUpdate();
        } else if (data.type === 'config') {
            // Atualizar taxas de corretagem e minProfit
            if (data.config.exchanges) {
                Object.assign(state.config.exchanges, data.config.exchanges);
                elements.mexcSpotFee.textContent = (state.config.exchanges.mexc.spotMakerFee * 100).toFixed(2);
                elements.mexcFuturesFee.textContent = (state.config.exchanges.mexc.futuresMakerFee * 100).toFixed(2);
                elements.gateioSpotFee.textContent = (state.config.exchanges.gateio.spotMakerFee * 100).toFixed(2);
                elements.gateioFuturesFee.textContent = (state.config.exchanges.gateio.futuresMakerFee * 100).toFixed(2);
            }
            if (data.config.arbitrage && data.config.arbitrage.minProfitPercentage !== undefined) {
                elements.minProfit.textContent = data.config.arbitrage.minProfitPercentage.toFixed(1);
            }
        }
    };

    ws.onclose = (event) => {
        console.log('WebSocket desconectado:', event.code, event.reason);
        state.connected = false;
        updateConnectionStatus();
        // Tentar reconectar após um atraso
        setTimeout(connectWebSocket, 3000); // Tenta reconectar após 3 segundos
    };

    ws.onerror = (error) => {
        console.error('WebSocket erro:', error);
        ws.close(); // Força o fechamento para tentar reconectar
    };
}

// --- Funções de Restrição de Assinatura ---
async function fetchUserData() {
    try {
        const response = await fetch('/api/users/me');
        if (response.ok) {
            const data = await response.json();
            state.currentUserSubscriptionStatus = data.user.subscriptionStatus;
            console.log('Status de assinatura do usuário:', state.currentUserSubscriptionStatus);
            
            // Aplicar restrições visuais após obter o status
            applySubscriptionRestrictions();
        } else if (response.status === 401) {
            // Não autenticado, redirecionar para login ou tratar como free
            console.warn('Usuário não autenticado. Redirecionando para login...');
            window.location.href = '/login.html';
        } else {
            console.error('Erro ao buscar dados do usuário:', response.status);
            // Em caso de erro, assumir free como padrão
            state.currentUserSubscriptionStatus = 'free';
            applySubscriptionRestrictions();
        }
    } catch (error) {
        console.error('Erro na requisição de dados do usuário:', error);
        // Em caso de erro, assumir free como padrão
        state.currentUserSubscriptionStatus = 'free';
        applySubscriptionRestrictions();
    }
}

function applySubscriptionRestrictions() {
    if (state.currentUserSubscriptionStatus === 'free') {
        // Mostrar banner de upgrade
        const banner = document.getElementById('test-version-banner');
        if (banner) {
            banner.style.display = 'block';
        }

        // Adicionar cadeados e desabilitar elementos premium
        addLockIcons();
        
        // Limitar opções de lucro de entrada para 1%
        limitProfitOptions();
    } else {
        // Esconder banner de upgrade
        const banner = document.getElementById('test-version-banner');
        if (banner) {
            banner.style.display = 'none';
        }
    }
}

function addLockIcons() {
    // Adicionar cadeados aos botões de navegação premium
    const saidaOpNav = document.getElementById('nav-saida-op');
    const ambosPositivosNav = document.getElementById('nav-ambos-positivos');
    
    if (saidaOpNav && !saidaOpNav.querySelector('.lock-icon')) {
        const lockIcon = document.createElement('span');
        lockIcon.className = 'lock-icon';
        lockIcon.textContent = '🔒';
        saidaOpNav.appendChild(lockIcon);
        saidaOpNav.classList.add('locked-feature');
    }
    
    if (ambosPositivosNav && !ambosPositivosNav.querySelector('.lock-icon')) {
        const lockIcon = document.createElement('span');
        lockIcon.className = 'lock-icon';
        lockIcon.textContent = '🔒';
        ambosPositivosNav.appendChild(lockIcon);
        ambosPositivosNav.classList.add('locked-feature');
    }

    // Adicionar cadeados aos filtros premium
    const premiumFilters = document.querySelectorAll('.premium-feature');
    premiumFilters.forEach(filter => {
        if (!filter.querySelector('.lock-icon')) {
            const lockIcon = document.createElement('span');
            lockIcon.className = 'lock-icon';
            lockIcon.textContent = '🔒';
            filter.appendChild(lockIcon);
            filter.classList.add('locked-feature');
        }
    });
}

function limitProfitOptions() {
    const profitSelect = document.getElementById('filter-min-profit-e-display');
    if (profitSelect) {
        // Desabilitar opções acima de 1%
        Array.from(profitSelect.options).forEach(option => {
            const value = parseFloat(option.value);
            if (value > 1.0) {
                option.disabled = true;
                option.textContent += ' 🔒';
            }
        });
    }
}

function showUpgradeAlert() {
    const upgradeMessage = document.getElementById('upgrade-message');
    if (upgradeMessage) {
        upgradeMessage.innerHTML = `
            <div style="background: #ff6b35; color: white; padding: 10px; text-align: center; position: fixed; top: 0; left: 0; right: 0; z-index: 1000;">
                Esta funcionalidade está disponível apenas na versão premium. 
                <button onclick="this.parentElement.style.display='none'" style="margin-left: 10px; background: white; color: #ff6b35; border: none; padding: 5px 10px; cursor: pointer;">Fechar</button>
            </div>
        `;
        setTimeout(() => {
            upgradeMessage.innerHTML = '';
        }, 5000);
    }
}

// Resto das funções (continuação do arquivo original)...
// [Aqui continuaria com todas as outras funções do arquivo original, como event listeners, etc.]

// --- EVENT LISTENERS E INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    // Buscar dados do usuário primeiro
    fetchUserData();
    
    // Conectar WebSocket
    connectWebSocket();
    
    // Resto da inicialização...
    loadFromLocalStorage();
    setupEventListeners();
    updateSortArrows();
    updateConnectionStatus();
    updateMainTitle();
});

// Funções auxiliares que faltam (simplificadas para este exemplo)
function loadFromLocalStorage() {
    // Implementar carregamento do localStorage
}

function setupEventListeners() {
    // Implementar event listeners
}

