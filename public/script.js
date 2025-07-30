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

    // Filtrar oportunidades bloqueadas para usuários free
    if (state.currentUserSubscriptionStatus === 'free') {
        opportunities = opportunities.filter(opWrapper => {
            const op = opWrapper.data;
            // Bloquear oportunidades com lucro de entrada >= 1%
            if (op.netSpreadPercentage >= 1.0) {
                // Adicionar ao blockedOps se ainda não estiver lá
                const blockedKey = `${op.pair}-${op.direction}`;
                if (!state.blockedOps.some(blockedOp => blockedOp.key === blockedKey)) {
                    state.blockedOps.push({ key: blockedKey, op: op });
                }
                return false; // Não incluir na lista de oportunidades visíveis
            }
            return true; // Incluir na lista de oportunidades visíveis
        });
    }

    // Atualizar contagem de oportunidades bloqueadas
    blockedOpsCountEl.textContent = state.blockedOps.length;

    return opportunities;
}

function calculateLucroS(op, allPairsData, config) {
    // Implementação da função calculateLucroS (assumindo que está em outro lugar ou é complexa)
    // Esta é uma versão simplificada para evitar erros de referência
    return op.lucroS || 0; // Retorna o lucroS se existir, senão 0
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

        // Adiciona classe para oportunidades premium se o usuário for free
        if (state.currentUserSubscriptionStatus === 'free' && op.netSpreadPercentage >= 1.0) {
            row.classList.add('premium-opportunity-row');
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

    // Tenta usar wss:// se a página for HTTPS, caso contrário, ws://
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
        } else if (response.status === 401) {
            // Não autenticado, redirecionar para login ou tratar como free
            console.warn('Usuário não autenticado. Redirecionando para login...');
            window.location.href = '/login.html'; // Redireciona para a página de login
            state.currentUserSubscriptionStatus = 'free'; // Fallback para free se não autenticado
        } else {
            console.error('Erro ao buscar dados do usuário:', response.status, response.statusText);
            state.currentUserSubscriptionStatus = 'free'; // Fallback para free em caso de erro
        }
    } catch (error) {
        console.error('Erro de rede ao buscar dados do usuário:', error);
        state.currentUserSubscriptionStatus = 'free'; // Fallback para free em caso de erro de rede
    } finally {
        applySubscriptionRestrictions();
    }
}

function applySubscriptionRestrictions() {
    const isFreeUser = state.currentUserSubscriptionStatus === 'free';

    // 1. Banner de Upgrade
    const upgradeBanner = document.getElementById('test-version-banner');
    if (upgradeBanner) {
        upgradeBanner.style.display = isFreeUser ? 'flex' : 'none';
    }

    // 2. Navegação (Saída OP, Ambos Positivos)
    const navSaidaOp = document.getElementById('nav-saida-op');
    const navAmbosPositivos = document.getElementById('nav-ambos-positivos');

    if (navSaidaOp) {
        if (isFreeUser) {
            navSaidaOp.classList.add('locked-feature');
            navSaidaOp.querySelector('.nav-item-text').innerHTML = `Saída OP <span class="lock-icon">🔒</span>`;
        } else {
            navSaidaOp.classList.remove('locked-feature');
            navSaidaOp.querySelector('.nav-item-text').innerHTML = `Saída OP`;
        }
    }
    if (navAmbosPositivos) {
        if (isFreeUser) {
            navAmbosPositivos.classList.add('locked-feature');
            navAmbosPositivos.querySelector('.nav-item-text').innerHTML = `Ambos Positivos <span class="lock-icon">🔒</span>`;
        } else {
            navAmbosPositivos.classList.remove('locked-feature');
            navAmbosPositivos.querySelector('.nav-item-text').innerHTML = `Ambos Positivos`;
        }
    }

    // 3. Filtros Premium
    const premiumFilterGroups = document.querySelectorAll('.filter-group.premium-feature');
    premiumFilterGroups.forEach(group => {
        if (isFreeUser) {
            group.classList.add('locked-feature');
            group.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
        } else {
            group.classList.remove('locked-feature');
            group.querySelectorAll('input, select, button').forEach(el => el.disabled = false);
        }
    });

    // 4. Limitar opções de lucro de entrada para free
    const filterMinProfitEDisplaySelect = document.getElementById('filter-min-profit-e-display');
    if (filterMinProfitEDisplaySelect) {
        Array.from(filterMinProfitEDisplaySelect.options).forEach(option => {
            const value = parseFloat(option.value);
            if (isFreeUser && value >= 1.0) {
                option.disabled = true;
                option.classList.add('premium-option');
            } else {
                option.disabled = false;
                option.classList.remove('premium-option');
            }
        });
        // Se o usuário free estiver com uma opção premium selecionada, resetar para 0
        if (isFreeUser && parseFloat(filterMinProfitEDisplaySelect.value) >= 1.0) {
            filterMinProfitEDisplaySelect.value = '0';
            state.filters.minProfitEFilterDisplay = 0;
        }
    }

    // 5. Esconder oportunidades Futuros vs Futuros e Spot vs Spot para free
    // Isso já é tratado na função getFilteredOpportunities, mas garantimos que os checkboxes estejam desmarcados
    if (isFreeUser) {
        filterEnableFutFutEl.checked = false;
        filterEnableSpotSpotEl.checked = false;
        state.config.arbitrage.enableFuturesVsFutures = false;
        state.config.arbitrage.enableSpotVsSpot = false;
    }

    requestUiUpdate(); // Força uma atualização da UI para aplicar as restrições
}

function showUpgradeAlert() {
    const upgradeMessageEl = document.getElementById('upgrade-message');
    if (upgradeMessageEl) {
        upgradeMessageEl.innerHTML = `
            <div class="alert-banner premium-alert">
                <div class="banner-content">
                    <span class="banner-icon">🔒</span>
                    <span class="banner-text">Funcionalidade Premium. Faça upgrade para desbloquear!</span>
                </div>
                <button class="banner-upgrade-button">Adquirir Premium</button>
                <button class="banner-close">×</button>
            </div>
        `;
        upgradeMessageEl.style.display = 'block';

        // Adicionar event listener para fechar o banner
        const closeButton = upgradeMessageEl.querySelector('.banner-close');
        if (closeButton) {
            closeButton.onclick = () => {
                upgradeMessageEl.style.display = 'none';
            };
        }
        // Adicionar event listener para o botão de upgrade
        const upgradeButton = upgradeMessageEl.querySelector('.banner-upgrade-button');
        if (upgradeButton) {
            upgradeButton.onclick = () => {
                // Redirecionar para a página de upgrade
                window.location.href = '/upgrade.html'; // Altere para a URL correta da sua página de upgrade
            };
        }
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    loadStateFromLocalStorage();
    updateConnectionStatus();
    connectWebSocket();
    fetchUserData(); // Busca o status de assinatura do usuário

    // Inicializa o estado do sidebar
    elements.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);

    // Inicializa o tema
    if (state.isDarkTheme) {
        document.body.classList.add('dark-theme');
        elements.sunIcon.style.display = 'none';
        elements.moonIcon.style.display = 'block';
        elements.themeToggleButton.querySelector('.control-button-text').textContent = 'Escuro';
    } else {
        document.body.classList.remove('dark-theme');
        elements.sunIcon.style.display = 'block';
        elements.moonIcon.style.display = 'none';
        elements.themeToggleButton.querySelector('.control-button-text').textContent = 'Claro';
    }

    // Inicializa o estado de pausa
    if (state.isPaused) {
        elements.pauseIcon.style.display = 'block';
        elements.playIcon.style.display = 'none';
        elements.togglePauseButton.querySelector('.control-button-text').textContent = 'Retomar';
    } else {
        elements.pauseIcon.style.display = 'none';
        elements.playIcon.style.display = 'block';
        elements.togglePauseButton.querySelector('.control-button-text').textContent = 'Pausar';
    }

    // Inicializa o estado do som
    if (state.soundEnabled) {
        elements.soundOnIcon.style.display = 'block';
        elements.soundOffIcon.style.display = 'none';
        elements.toggleSoundButton.querySelector('.control-button-text').textContent = 'Som ON';
    } else {
        elements.soundOnIcon.style.display = 'none';
        elements.soundOffIcon.style.display = 'block';
        elements.toggleSoundButton.querySelector('.control-button-text').textContent = 'Som OFF';
    }

    // Inicializa o estado de exibição de oportunidades bloqueadas
    const blockedTableContainer = document.getElementById('blocked-ops-table-container');
    const text = elements.toggleBlockedOps?.querySelector('span');
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

    // Inicializa o estado dos filtros
    filterCheckboxes.mexcSpot.checked = state.filters.mexcSpot;
    filterCheckboxes.mexcFutures.checked = state.filters.mexcFutures;
    filterCheckboxes.gateioSpot.checked = state.filters.gateioSpot;
    filterCheckboxes.gateioFutures.checked = state.filters.gateioFutures;
    filterMinVolumeInput.value = state.filters.minVolume;
    filterMinProfitEDisplayEl.value = state.filters.minProfitEFilterDisplay;
    filterMinProfitSDisplayEl.value = state.filters.minProfitSFilterDisplay;
    filterEnableFutFutEl.checked = state.config.arbitrage.enableFuturesVsFutures;
    filterEnableSpotSpotEl.checked = state.config.arbitrage.enableSpotVsSpot;
    soundProfitThresholdInputEl.value = state.soundProfitThreshold;
    defaultCapitalInputEl.value = state.defaultCapitalUSD;
    filterFundingMinInput.value = state.filters.minFundingRate !== null ? state.filters.minFundingRate : '';
    filterFundingMaxInput.value = state.filters.maxFundingRate !== null ? state.filters.maxFundingRate : '';

    // Inicializa o estado de expansão das seções
    watchedPairsTableContainerEl.style.display = state.isWatchedPairsExpanded ? '' : 'none';
    watchedPairsToggleIconEl.innerHTML = state.isWatchedPairsExpanded ? ICON_EXPANDED : ICON_COLLAPSED;
    monitorParesTableContainerEl.style.display = state.isMonitorParesExpanded ? '' : 'none';
    monitorParesToggleIconEl.innerHTML = state.isMonitorParesExpanded ? ICON_EXPANDED : ICON_COLLAPSED;

    // Define a view inicial
    setCurrentView(state.currentView);
    updateMainTitle();
    requestUiUpdate();
});

elements.sidebarToggle.addEventListener('click', toggleSidebar);
elements.navArbitragens.addEventListener('click', () => setCurrentView('arbitragens'));
elements.navSaidaOp.addEventListener('click', () => setCurrentView('saida-op'));
elements.navAmbosPositivos.addEventListener('click', () => setCurrentView('ambos-positivos'));
elements.toggleBlockedOps.addEventListener('click', toggleBlockedOps);
elements.toggleSoundButton.addEventListener('click', toggleSound);
elements.themeToggleButton.addEventListener('click', toggleTheme);
elements.togglePauseButton.addEventListener('click', togglePause);
elements.logoutButton.addEventListener('click', () => {
    localStorage.removeItem('token'); // Remove o token JWT
    window.location.href = '/login.html'; // Redireciona para a página de login
});

watchedPairsHeaderEl.addEventListener('click', () => {
    state.isWatchedPairsExpanded = !state.isWatchedPairsExpanded;
    watchedPairsTableContainerEl.style.display = state.isWatchedPairsExpanded ? '' : 'none';
    watchedPairsToggleIconEl.innerHTML = state.isWatchedPairsExpanded ? ICON_EXPANDED : ICON_COLLAPSED;
    saveStateToLocalStorage();
});

monitorParesHeaderEl.addEventListener('click', () => {
    state.isMonitorParesExpanded = !state.isMonitorParesExpanded;
    monitorParesTableContainerEl.style.display = state.isMonitorParesExpanded ? '' : 'none';
    monitorParesToggleIconEl.innerHTML = state.isMonitorParesExpanded ? ICON_EXPANDED : ICON_COLLAPSED;
    saveStateToLocalStorage();
});

// --- Event Listeners para Filtros ---
Object.values(filterCheckboxes).forEach(checkbox => {
    checkbox.addEventListener('change', (event) => {
        state.filters[event.target.dataset.filterkey] = event.target.checked;
        saveStateToLocalStorage();
        requestUiUpdate();
    });
});

filterMinVolumeInput.addEventListener('input', (event) => {
    state.filters.minVolume = parseFloat(event.target.value) || 0;
    saveStateToLocalStorage();
    requestUiUpdate();
});

filterMinProfitEDisplayEl.addEventListener('change', (event) => {
    state.filters.minProfitEFilterDisplay = parseFloat(event.target.value);
    saveStateToLocalStorage();
    requestUiUpdate();
});

filterMinProfitSDisplayEl.addEventListener('change', (event) => {
    state.filters.minProfitSFilterDisplay = parseFloat(event.target.value);
    saveStateToLocalStorage();
    requestUiUpdate();
});

filterEnableFutFutEl.addEventListener('change', (event) => {
    state.config.arbitrage.enableFuturesVsFutures = event.target.checked;
    saveStateToLocalStorage();
    requestUiUpdate();
});

filterEnableSpotSpotEl.addEventListener('change', (event) => {
    state.config.arbitrage.enableSpotVsSpot = event.target.checked;
    saveStateToLocalStorage();
    requestUiUpdate();
});

soundProfitThresholdInputEl.addEventListener('input', (event) => {
    state.soundProfitThreshold = parseFloat(event.target.value) || 0;
    saveStateToLocalStorage();
});

defaultCapitalInputEl.addEventListener('input', (event) => {
    state.defaultCapitalUSD = parseFloat(event.target.value) || 0;
    qtySugBaseUnitHeaderEl.textContent = `(${state.defaultCapitalUSD > 0 ? 'USD' : 'QTD'})`;
    saveStateToLocalStorage();
    requestUiUpdate();
});

filterFundingMinInput.addEventListener('input', (event) => {
    state.filters.minFundingRate = event.target.value === '' ? null : parseFloat(event.target.value);
    saveStateToLocalStorage();
    requestUiUpdate();
});

filterFundingMaxInput.addEventListener('input', (event) => {
    state.filters.maxFundingRate = event.target.value === '' ? null : parseFloat(event.target.value);
    saveStateToLocalStorage();
    requestUiUpdate();
});

// --- Watchlist ---
addWatchPairButtonEl.addEventListener('click', () => {
    const pair = watchPairInputEl.value.trim().toUpperCase();
    if (pair && !state.watchedPairsList.includes(pair)) {
        state.watchedPairsList.push(pair);
        watchPairInputEl.value = '';
        saveStateToLocalStorage();
        requestUiUpdate();
        updateWatchedPairsCount();
    }
});

function updateWatchedPairsCount() {
    watchedPairsCountEl.textContent = state.watchedPairsList.length;
}

// --- Event Listeners para botões dinâmicos (delegação) ---
opportunitiesTableBodyEl.addEventListener('click', (event) => {
    if (event.target.classList.contains('favorite-button')) {
        const pair = event.target.dataset.pair;
        toggleFavorite(pair);
    } else if (event.target.classList.contains('pair-link')) {
        event.preventDefault();
        const pair = event.target.dataset.pair;
        const direction = event.target.dataset.direction;
        const buyEx = event.target.dataset.buyExchange;
        const sellEx = event.target.dataset.sellExchange;
        const buyInstrument = event.target.dataset.buyInstrument;
        const sellInstrument = event.target.dataset.sellInstrument;
        const opDataForCopyStr = event.target.dataset.opData;
        abrirGraficosComLayout(buyEx, buyInstrument, sellEx, sellInstrument, pair, direction, opDataForCopyStr);
    } else if (event.target.classList.contains('calculator-button')) {
        const pair = event.target.dataset.pair;
        const direction = event.target.dataset.direction;
        const buyEx = event.target.dataset.buyEx;
        const sellEx = event.target.dataset.sellEx;
        abrirCalculadora(pair, direction, buyEx, sellEx, true);
    }
});

blockedOpsTableBodyEl.addEventListener('click', (event) => {
    if (event.target.classList.contains('unblock-button')) {
        const key = event.target.dataset.key;
        unblockOpportunity(key);
    }
});

function toggleFavorite(pair) {
    const index = state.favoritedOps.indexOf(pair);
    if (index > -1) {
        state.favoritedOps.splice(index, 1);
    } else {
        state.favoritedOps.push(pair);
    }
    saveStateToLocalStorage();
    requestUiUpdate();
}

function unblockOpportunity(key) {
    state.blockedOps = state.blockedOps.filter(op => op.key !== key);
    saveStateToLocalStorage();
    requestUiUpdate();
}

// --- Local Storage ---
function saveStateToLocalStorage() {
    localStorage.setItem(DEFAULT_CAPITAL_STORAGE_KEY, state.defaultCapitalUSD);
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state.favoritedOps));
    localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(state.blockedOps));
    localStorage.setItem(MONITOR_PARES_EXPANDED_KEY, state.isMonitorParesExpanded);
    localStorage.setItem(WATCHED_PAIRS_EXPANDED_KEY, state.isWatchedPairsExpanded);
    localStorage.setItem(HIDDEN_WATCHED_OPS_STORAGE_KEY, JSON.stringify(Array.from(state.hiddenWatchedOps)));
    localStorage.setItem(THEME_STORAGE_KEY, state.isDarkTheme ? 'dark' : 'light');

    // Salvar filtros
    localStorage.setItem('arbitrageDashboard_filters_v1', JSON.stringify(state.filters));
    localStorage.setItem('arbitrageDashboard_config_arbitrage_v1', JSON.stringify(state.config.arbitrage));
    localStorage.setItem('arbitrageDashboard_soundProfitThreshold_v1', state.soundProfitThreshold);
    localStorage.setItem('arbitrageDashboard_sidebarCollapsed_v1', state.sidebarCollapsed);
    localStorage.setItem('arbitrageDashboard_currentView_v1', state.currentView);
    localStorage.setItem('arbitrageDashboard_showBlockedOps_v1', state.showBlockedOps);
}

function loadStateFromLocalStorage() {
    state.defaultCapitalUSD = parseFloat(localStorage.getItem(DEFAULT_CAPITAL_STORAGE_KEY)) || 0;
    state.favoritedOps = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY)) || [];
    state.blockedOps = JSON.parse(localStorage.getItem(BLOCKED_STORAGE_KEY)) || [];
    state.isMonitorParesExpanded = localStorage.getItem(MONITOR_PARES_EXPANDED_KEY) === 'true';
    state.isWatchedPairsExpanded = localStorage.getItem(WATCHED_PAIRS_EXPANDED_KEY) === 'true';
    state.hiddenWatchedOps = new Set(JSON.parse(localStorage.getItem(HIDDEN_WATCHED_OPS_STORAGE_KEY)) || []);
    state.isDarkTheme = localStorage.getItem(THEME_STORAGE_KEY) === 'dark';

    // Carregar filtros
    const savedFilters = JSON.parse(localStorage.getItem('arbitrageDashboard_filters_v1'));
    if (savedFilters) {
        Object.assign(state.filters, savedFilters);
    }
    const savedArbitrageConfig = JSON.parse(localStorage.getItem('arbitrageDashboard_config_arbitrage_v1'));
    if (savedArbitrageConfig) {
        Object.assign(state.config.arbitrage, savedArbitrageConfig);
    }
    state.soundProfitThreshold = parseFloat(localStorage.getItem('arbitrageDashboard_soundProfitThreshold_v1')) || 0;
    state.sidebarCollapsed = localStorage.getItem('arbitrageDashboard_sidebarCollapsed_v1') === 'true';
    state.currentView = localStorage.getItem('arbitrageDashboard_currentView_v1') || 'arbitragens';
    state.showBlockedOps = localStorage.getItem('arbitrageDashboard_showBlockedOps_v1') === 'true';

    // Atualizar o header da quantidade sugerida com base no capital padrão carregado
    qtySugBaseUnitHeaderEl.textContent = `(${state.defaultCapitalUSD > 0 ? 'USD' : 'QTD'})`;
}

function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    if (state.soundEnabled && !state.soundPermissionGranted) {
        // Solicitar permissão de áudio se ainda não foi concedida
        // (Esta parte pode ser mais complexa e depende do navegador, 
        // para simplificar, assumimos que a permissão é dada ao interagir)
        state.soundPermissionGranted = true; 
    }
    elements.soundOnIcon.style.display = state.soundEnabled ? 'block' : 'none';
    elements.soundOffIcon.style.display = state.soundEnabled ? 'none' : 'block';
    elements.toggleSoundButton.querySelector('.control-button-text').textContent = state.soundEnabled ? 'Som ON' : 'Som OFF';
    saveStateToLocalStorage();
}

function toggleTheme() {
    state.isDarkTheme = !state.isDarkTheme;
    document.body.classList.toggle('dark-theme', state.isDarkTheme);
    elements.sunIcon.style.display = state.isDarkTheme ? 'none' : 'block';
    elements.moonIcon.style.display = state.isDarkTheme ? 'block' : 'none';
    elements.themeToggleButton.querySelector('.control-button-text').textContent = state.isDarkTheme ? 'Escuro' : 'Claro';
    saveStateToLocalStorage();
}

function togglePause() {
    state.isPaused = !state.isPaused;
    elements.pauseIcon.style.display = state.isPaused ? 'block' : 'none';
    elements.playIcon.style.display = state.isPaused ? 'none' : 'block';
    elements.togglePauseButton.querySelector('.control-button-text').textContent = state.isPaused ? 'Retomar' : 'Pausar';
    saveStateToLocalStorage();
}

// --- Inicialização ---
// Já está no DOMContentLoaded

// Exemplo de uso de sound alert (precisa de um arquivo de áudio e lógica de reprodução)
// function playSoundAlert() {
//     const audio = new Audio('path/to/your/alert.mp3');
//     audio.play().catch(e => console.error("Erro ao tocar som:", e));
// }

