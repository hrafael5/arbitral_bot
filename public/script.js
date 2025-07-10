// --- ESTADO INICIAL E SELETORES DOM ---
const OPPORTUNITY_TTL_MS = 10000;
const DEFAULT_CAPITAL_STORAGE_KEY = 'arbitrageDashboard_defaultCapital_v1';
const MONITOR_PARES_EXPANDED_KEY = 'arbitrageDashboard_monitorParesExpanded_v1';
const WATCHED_PAIRS_EXPANDED_KEY = 'arbitrageDashboard_watchedPairsExpanded_v1';

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
  tempHiddenWatchedOps: new Set(),
  soundEnabled: false,
  soundPermissionGranted: false,
  soundProfitThreshold: 0.0,
  soundPlayedForVisibleOps: new Set(),
  isWatchedPairsExpanded: false,
  isMonitorParesExpanded: false,
  sidebarCollapsed: false,
  currentView: 'arbitragens',
  showBlockedOps: false,
  isDarkTheme: false
};

window.frontendState = state;

const FAVORITES_STORAGE_KEY = 'arbitrageDashboard_favoritedOps_v1';
const BLOCKED_STORAGE_KEY = 'arbitrageDashboard_blockedOps_v2'; 
// const WATCHED_PAIRS_STORAGE_KEY = 'arbitrageDashboard_watchedPairs_v2'; // Não é mais necessário
const THEME_STORAGE_KEY = 'arbitrageDashboard_theme_v1'; 

// Ícones SVG para expandir/recolher
const ICON_COLLAPSED = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
const ICON_EXPANDED = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(90deg);"><polyline points="9 18 15 12 9 6"></polyline></svg>`;


// Seletores DOM
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
    const qtd = Math.floor(qtdFloat);
    if (qtd <= 0) return 0;
    return qtd;
}

function copiarParaClipboard(texto, buttonElement) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(texto)).then(() => {
            const tooltip = document.createElement('div');
            tooltip.textContent = 'Qtd. Copiada!';
            tooltip.style.position = 'fixed';
            tooltip.style.left = '50%';
            tooltip.style.top = '20px';
            tooltip.style.transform = 'translateX(-50%)';
            tooltip.style.padding = '10px 20px';
            tooltip.style.background = '#238636';
            tooltip.style.color = 'white';
            tooltip.style.borderRadius = '5px';
            tooltip.style.zIndex = '10000';
            tooltip.style.transition = 'opacity 0.5s ease-out';
            document.body.appendChild(tooltip);
            setTimeout(() => {
                tooltip.style.opacity = '0';
                setTimeout(() => {
                    if (document.body.contains(tooltip)) {
                        document.body.removeChild(tooltip);
                    }
                }, 500);
            }, 1500);

            if (buttonElement) {
                const originalText = buttonElement.textContent;
                buttonElement.textContent = '✓';
                setTimeout(() => {
                    buttonElement.textContent = originalText;
                }, 1000);
            }
        }).catch(err => {
            console.error('FRONTEND: Falha ao copiar:', err);
            alert('Falha ao copiar. Verifique as permissões do navegador (a página precisa ser HTTPS ou localhost).');
        });
    } else {
        alert('A função de copiar não é suportada ou está bloqueada neste navegador (a página precisa ser HTTPS ou localhost).');
    }
}

// --- CORREÇÃO 1: Ajuste na lógica para gerar o link da Gate.io corretamente ---
function getExchangeUrl(exchange, instrument, pair) {
    const pairForURL = pair.replace('/', '_').toUpperCase();
    const exchangeLower = (exchange || '').toLowerCase(); // Apenas convertemos para minúsculas
    const instrumentUpper = (instrument || '').toUpperCase();
    const finalInstrument = (instrumentUpper === 'SPOT' || instrumentUpper === 'PONTO') ? 'spot' : 'futures';

    if (exchangeLower === 'mexc') {
        return finalInstrument === 'spot' ? `https://www.mexc.com/exchange/${pairForURL}?type=spot` : `https://futures.mexc.com/exchange/${pairForURL}`;
    } else if (exchangeLower === 'gateio' || exchangeLower === 'gate.io') { // Agora checa por 'gateio' ou 'gate.io'
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

function abrirCalculadora(pair, direction, buyEx, sellEx) {
    const url = `realtime_profit_calc.html?pair=${encodeURIComponent(pair)}&direction=${encodeURIComponent(direction)}&buyEx=${encodeURIComponent(buyEx)}&sellEx=${encodeURIComponent(sellEx)}`;
    const windowName = 'arbitrage_calculator_window';
    const popWidth = 420;
    const popHeight = 220;
    const left = (window.screen.availWidth / 2) - (popWidth / 2);
    const top = (window.screen.availHeight / 2) - (popHeight / 2);
    const features = `width=${popWidth},height=${popHeight},top=${top},left=${left},resizable=yes,scrollbars=yes`;
    const calcWindow = window.open('', windowName, features);
    if (calcWindow.location.href !== url) {
        calcWindow.location.href = url;
    }
    calcWindow.focus();
}

function abrirGraficosComLayout(buyExchange, buyInstrument, sellExchange, sellInstrument, pair, direction, opDataForCopyStr) {
    let opDataToUse = null;
    if (typeof opDataForCopyStr === 'string' && opDataForCopyStr) {
        try {
            opDataToUse = JSON.parse(opDataForCopyStr.replace(/&quot;/g, '"'));
        } catch (e) {
            console.error("FRONTEND: Falha ao parsear opDataForCopyStr em abrirGraficosComLayout", e);
        }
    }

    if (opDataToUse && opDataToUse.buyPrice && state.defaultCapitalUSD > 0) {
        const buyPrice = parseFloat(opDataToUse.buyPrice);
        if (buyPrice > 0) {
            const qtdOriginal = state.defaultCapitalUSD / buyPrice;
            const qtdSugerida = arredondarQuantidadeSugerida(qtdOriginal);
            if (qtdSugerida > 0) {
                copiarParaClipboard(qtdSugerida);
            }
        }
    }

    let spotUrl, futuresUrl;
    const isBuySpot = buyInstrument.toLowerCase().includes('spot') || buyInstrument.toLowerCase().includes('ponto');
    if (isBuySpot) {
        spotUrl = getExchangeUrl(buyExchange, 'spot', pair);
        futuresUrl = getExchangeUrl(sellExchange, 'futures', pair);
    } else {
        spotUrl = getExchangeUrl(sellExchange, 'spot', pair);
        futuresUrl = getExchangeUrl(buyExchange, 'futures', pair);
    }

    abrirJanelaDeGrafico(spotUrl, 'arbitrage_spot_window', 'left');
    abrirJanelaDeGrafico(futuresUrl, 'arbitrage_futures_window', 'right');
    abrirCalculadora(pair, direction, buyExchange, sellExchange);
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  const isCollapsed = elements.sidebar.classList.toggle('collapsed');
  
  if (elements.menuIcon) elements.menuIcon.style.display = isCollapsed ? 'block' : 'none';
  if (elements.closeIcon) elements.closeIcon.style.display = isCollapsed ? 'none' : 'block';
}

function setCurrentView(view) {
  state.currentView = view;

  if (view === 'saida-op') {
    state.sortColumn = 'lucroS';
    state.sortDirection = 'desc';
    if(filterGroupLucroE) filterGroupLucroE.style.display = 'none';
    if(filterGroupLucroS) filterGroupLucroS.style.display = 'flex';
  } else { 
    state.sortColumn = 'netSpreadPercentage';
    state.sortDirection = 'desc';
    if(filterGroupLucroE) filterGroupLucroE.style.display = 'flex';
    if(filterGroupLucroS) filterGroupLucroS.style.display = 'none';
  }
  
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  
  const activeNavElement = document.getElementById(`nav-${view.replace('-', '_')}`);
  if (activeNavElement) {
    activeNavElement.classList.add('active');
  } else {
    const fallbackElement = document.getElementById(`nav-${view}`);
    if (fallbackElement) {
        fallbackElement.classList.add('active');
    }
  }
  
  updateMainTitle();
  requestUiUpdate();
}

function updateMainTitle() {
  const filteredOpportunities = getFilteredOpportunities();
  const count = filteredOpportunities.length;

  if (state.currentView === 'arbitragens') {
    if (elements.viewTitle) elements.viewTitle.textContent = `Arbitragens (${count})`;
    if (elements.viewSubtitle) elements.viewSubtitle.textContent = 'Oportunidades com Lucro de Entrada positivo';
  } else if (state.currentView === 'saida-op') {
    if (elements.viewTitle) elements.viewTitle.textContent = `Monitor de Saída (${count})`;
    if (elements.viewSubtitle) elements.viewSubtitle.textContent = 'Oportunidades com Lucro de Saída positivo';
  } else if (state.currentView === 'ambos-positivos') {
    if (elements.viewTitle) elements.viewTitle.textContent = `Ambos Positivos (${count})`;
    if (elements.viewSubtitle) elements.viewSubtitle.textContent = 'Oportunidades com Lucro de Entrada E Saída positivos';
  }
}

function toggleBlockedOps() {
  state.showBlockedOps = !state.showBlockedOps;
  const text = elements.toggleBlockedOps?.querySelector('span');
  
  const blockedTableContainer = document.getElementById('blocked-ops-table-container');

  if (state.showBlockedOps) {
    if (elements.eyeIcon) elements.eyeIcon.style.display = 'block';
    if (elements.eyeOffIcon) elements.eyeOffIcon.style.display = 'none';
    if (text) text.textContent = 'Esconder Oportunidades Bloqueadas';
    if (blockedTableContainer) blockedTableContainer.style.display = '';
  } else {
    if (elements.eyeIcon) elements.eyeIcon.style.display = 'none';
    if (elements.eyeOffIcon) elements.eyeOffIcon.style.display = 'block';
    if (text) text.textContent = 'Mostrar Oportunidades Bloqueadas';
    if (blockedTableContainer) blockedTableContainer.style.display = 'none';
  }
}

function getFilteredOpportunities() {
    let filteredOpWrappers = state.arbitrageOpportunities.filter(opWrapper => {
      const op = opWrapper.data;
      
      if (state.watchedPairsList.includes(op.pair)) {
          return false;
      }
  
      if (state.currentView === 'arbitragens') {
          if (op.netSpreadPercentage <= 0) return false;
          if (state.filters.minProfitEFilterDisplay > 0 && op.netSpreadPercentage < state.filters.minProfitEFilterDisplay) return false;
      
      } else if (state.currentView === 'saida-op') {
          const lucroS = calculateLucroS(op, state.allPairsData, state.config);
          if (lucroS === null || lucroS <= 0) return false;
          if (state.filters.minProfitSFilterDisplay > 0 && lucroS < state.filters.minProfitSFilterDisplay) return false;
      
      } else if (state.currentView === 'ambos-positivos') {
          const lucroS = calculateLucroS(op, state.allPairsData, state.config);
          if (op.netSpreadPercentage <= 0 || lucroS === null || lucroS <= 0) return false;
          if (state.filters.minProfitEFilterDisplay > 0 && op.netSpreadPercentage < state.filters.minProfitEFilterDisplay) return false;
      }
  
      const isFutFut = (op.buyInstrument?.toLowerCase().includes('futur')) && 
                       (op.sellInstrument?.toLowerCase().includes('futur'));
      const isSpotSpot = (op.buyInstrument?.toLowerCase().includes('spot')) && 
                         (op.sellInstrument?.toLowerCase().includes('spot'));
  
      if (isFutFut && !state.config.arbitrage.enableFuturesVsFutures) return false;
      if (isSpotSpot && !state.config.arbitrage.enableSpotVsSpot) return false;
      
      const volume = getVolumeForFiltering(op);
      if (state.filters.minVolume > 0 && volume < state.filters.minVolume) return false;
      
      const buyExchange = op.buyExchange?.toLowerCase();
      const sellExchange = op.sellExchange?.toLowerCase();
      const buyMarket = op.buyInstrument?.toLowerCase();
      const sellMarket = op.sellInstrument?.toLowerCase();
      
      let buyAllowed = false;
      let sellAllowed = false;
      
      if (buyExchange === 'mexc' && (buyMarket === 'spot' || buyMarket === 'ponto') && state.filters.mexcSpot) buyAllowed = true;
      else if (buyExchange === 'mexc' && (buyMarket === 'futures' || buyMarket === 'futuros') && state.filters.mexcFutures) buyAllowed = true;
      else if (buyExchange === 'gateio' && (buyMarket === 'spot' || buyMarket === 'ponto') && state.filters.gateioSpot) buyAllowed = true;
      else if (buyExchange === 'gateio' && (buyMarket === 'futures' || buyMarket === 'futuros') && state.filters.gateioFutures) buyAllowed = true;
      
      if (sellExchange === 'mexc' && (sellMarket === 'spot' || sellMarket === 'ponto') && state.filters.mexcSpot) sellAllowed = true;
      else if (sellExchange === 'mexc' && (sellMarket === 'futures' || sellMarket === 'futuros') && state.filters.mexcFutures) sellAllowed = true;
      else if (sellExchange === 'gateio' && (sellMarket === 'spot' || sellMarket === 'ponto') && state.filters.gateioSpot) sellAllowed = true;
      else if (sellExchange === 'gateio' && (sellMarket === 'futures' || sellMarket === 'futuros') && state.filters.gateioFutures) sellAllowed = true;
      
      if (!(buyAllowed && sellAllowed)) return false;
  
      const minFunding = state.filters.minFundingRate;
      const maxFunding = state.filters.maxFundingRate;
  
      if (minFunding !== null || maxFunding !== null) {
          let fundingRate = op.type === "INTER_EXCHANGE_FUT_FUT" ? op.fundingRate_sellLeg : op.fundingRate;
          if (fundingRate === null || fundingRate === undefined) return false;
          
          const fundingRatePercent = fundingRate * 100;
  
          if (minFunding !== null && fundingRatePercent < minFunding) return false;
          if (maxFunding !== null && fundingRatePercent > maxFunding) return false;
      }
  
      const opKey = `${opWrapper.data.pair}-${opWrapper.data.direction}`;
      if (state.blockedOps.some(blockedOp => blockedOp.key === opKey)) return false;
  
      return true;
    });
  
    return filteredOpWrappers;
}

function getVolumeForFiltering(op) {
  const isFutFutType = op.type === "INTER_EXCHANGE_FUT_FUT";
  const isSpotSpotType = op.type === "INTER_EXCHANGE_SPOT_SPOT";

  if (isFutFutType) {
    const volBuy = op.futuresVolume24hUSD_buyLeg !== undefined ? op.futuresVolume24hUSD_buyLeg : op.futuresVolume24hUSD;
    const volSell = op.futuresVolume24hUSD_sellLeg !== undefined ? op.futuresVolume24hUSD_sellLeg : op.futuresVolume24hUSD;
    return Math.min(volBuy || 0, volSell || 0);
  } else if (isSpotSpotType) { 
    const volBuy = op.spotVolume24hUSD_buyLeg;
    const volSell = op.spotVolume24hUSD_sellLeg;
    return Math.min(volBuy || 0, volSell || 0);
  } else {
    return Math.min(op.spotVolume24hUSD || 0, op.futuresVolume24hUSD || 0);
  }
}

function applyTheme(theme) { 
  if (theme === 'dark') { 
    document.body.classList.add('dark'); 
    state.isDarkTheme = true;
  } else { 
    document.body.classList.remove('dark'); 
    state.isDarkTheme = false;
  } 
  updateThemeButton();
}

function updateThemeButton() {
  const text = elements.themeToggleButton?.querySelector('.control-button-text');
  
  if (state.isDarkTheme) {
    if (elements.sunIcon) elements.sunIcon.style.display = 'none';
    if (elements.moonIcon) elements.moonIcon.style.display = 'block';
    if (text) text.textContent = 'Escuro';
  } else {
    if (elements.sunIcon) elements.sunIcon.style.display = 'block';
    if (elements.moonIcon) elements.moonIcon.style.display = 'none';
    if (text) text.textContent = 'Claro';
  }
}

function toggleTheme() { 
  const newTheme = state.isDarkTheme ? 'light' : 'dark'; 
  localStorage.setItem(THEME_STORAGE_KEY, newTheme); 
  applyTheme(newTheme); 
}

const notificationSound = new Audio('notification.mp3'); 
notificationSound.preload = 'auto';

function updateSoundButton() {
  const button = elements.toggleSoundButton;
  const text = button?.querySelector('.control-button-text');
  
  if (state.soundEnabled) {
    button?.classList.add('active');
    if (elements.soundOnIcon) elements.soundOnIcon.style.display = 'block';
    if (elements.soundOffIcon) elements.soundOffIcon.style.display = 'none';
    if (text) text.textContent = 'Som ON';
  } else {
    button?.classList.remove('active');
    if (elements.soundOnIcon) elements.soundOnIcon.style.display = 'none';
    if (elements.soundOffIcon) elements.soundOffIcon.style.display = 'block';
    if (text) text.textContent = 'Som OFF';
  }
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  updateSoundButton();
  if (state.soundEnabled) {
    tryUnlockSoundPermission();
  }
}

function tryUnlockSoundPermission() { 
  if (state.soundPermissionGranted) return; 
  const currentVolume = notificationSound.volume; 
  notificationSound.volume = 0.001; 
  const playPromise = notificationSound.play(); 
  if (playPromise !== undefined) { 
    playPromise.then(() => { 
      notificationSound.pause(); 
      notificationSound.currentTime = 0; 
      notificationSound.volume = currentVolume; 
      state.soundPermissionGranted = true; 
      console.log("FRONTEND: Permissão de áudio concedida."); 
    }).catch(error => { 
      notificationSound.volume = currentVolume; 
      console.warn("FRONTEND: Permissão de áudio falhou.", error.name); 
      state.soundPermissionGranted = false; 
    });
  } else { 
    notificationSound.volume = currentVolume; 
    console.warn("FRONTEND: Navegador não suporta playPromise, permissão de som incerta."); 
  } 
}

function playSoundNotification() { 
  if (state.soundEnabled && state.soundPermissionGranted) { 
    notificationSound.play().catch(error => { 
      console.error("FRONTEND: Erro ao tocar som:", error); 
      if (error.name === 'NotAllowedError') { 
        state.soundPermissionGranted = false; 
        updateSoundButton(); 
        console.warn("FRONTEND: Reprodução bloqueada."); 
      } 
    }); 
  } else if (state.soundEnabled && !state.soundPermissionGranted) { 
    tryUnlockSoundPermission(); 
  } 
}

function updatePauseButton() {
  const button = elements.togglePauseButton;
  const text = button?.querySelector('.control-button-text');
  
  if (state.isPaused) {
    button?.classList.add('paused');
    if (elements.pauseIcon) elements.pauseIcon.style.display = 'none';
    if (elements.playIcon) elements.playIcon.style.display = 'block';
    if (text) text.textContent = 'Retomar';
  } else {
    button?.classList.remove('paused');
    if (elements.pauseIcon) elements.pauseIcon.style.display = 'block';
    if (elements.playIcon) elements.playIcon.style.display = 'none';
    if (text) text.textContent = 'Pausar';
  }
}

function loadFavorites() { 
  const stored = localStorage.getItem(FAVORITES_STORAGE_KEY); 
  state.favoritedOps = stored ? (JSON.parse(stored) || []) : []; 
}

function saveFavorites() { 
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state.favoritedOps)); 
}

function loadBlockedOps() { 
  const stored = localStorage.getItem(BLOCKED_STORAGE_KEY); 
  state.blockedOps = stored ? (JSON.parse(stored) || []) : [];
  if (!Array.isArray(state.blockedOps)) state.blockedOps = [];
}

function saveBlockedOps() { 
  localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(state.blockedOps)); 
}

async function loadWatchedPairs() {
  try {
    const response = await fetch('/api/users/settings');
    if (response.ok) {
        const settings = await response.json();
        state.watchedPairsList = settings.watchedPairs || [];
        if (watchedPairsCountEl) {
            watchedPairsCountEl.textContent = state.watchedPairsList.length;
        }
        requestUiUpdate();
    } else {
        console.error("Não foi possível carregar os pares vigiados do servidor.");
        state.watchedPairsList = [];
    }
  } catch (error) {
    console.error("Erro de conexão ao carregar pares vigiados:", error);
    state.watchedPairsList = [];
  }
}

async function saveWatchedPairs() {
    if (watchedPairsCountEl) {
        watchedPairsCountEl.textContent = state.watchedPairsList.length;
    }
    try {
        await fetch('/api/users/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ watchedPairs: state.watchedPairsList })
        });
    } catch (error) {
        console.error("Erro ao salvar pares vigiados no servidor:", error);
    }
}

function addWatchedPair() { 
  if (!watchPairInputEl) return; 
  const pairToAdd = watchPairInputEl.value.trim().toUpperCase().replace(/[^A-Z0-9\/]/g, ''); 
  if (pairToAdd && /^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/.test(pairToAdd)) { 
    if (!state.watchedPairsList.includes(pairToAdd)) { 
      state.watchedPairsList.push(pairToAdd); 
      saveWatchedPairs(); 
    } else {
      const newHiddenOps = new Set();
      state.tempHiddenWatchedOps.forEach(hiddenOpKey => {
        if (!hiddenOpKey.startsWith(pairToAdd + '|')) {
          newHiddenOps.add(hiddenOpKey);
        }
      });
      state.tempHiddenWatchedOps = newHiddenOps;
    }
    requestUiUpdate();
    watchPairInputEl.value = ''; 
  } else { 
    alert("Formato de par inválido. Use BASE/COTACAO (ex: BTC/USDT)."); 
  } 
}

function toggleFavorite(opKey) { 
  if (!opKey) return; 
  const favoriteIndex = state.favoritedOps.indexOf(opKey); 
  const blockedItemIndex = state.blockedOps.findIndex(b => b.key === opKey); 

  if (favoriteIndex > -1) { 
    state.favoritedOps.splice(favoriteIndex, 1); 
  } else { 
    state.favoritedOps.push(opKey); 
    if (blockedItemIndex > -1) { 
      state.blockedOps.splice(blockedItemIndex, 1); 
      saveBlockedOps(); 
    } 
  } 
  saveFavorites(); 
  requestUiUpdate(); 
}

function toggleBlock(opKey, opDataSnapshotString) {
  if (!opKey) return;
  const blockedItemIndex = state.blockedOps.findIndex(b => b.key === opKey);
  const favoriteIndex = state.favoritedOps.indexOf(opKey);

  if (blockedItemIndex > -1) { 
    state.blockedOps.splice(blockedItemIndex, 1);
  } else { 
    try {
      const opDataSnapshot = JSON.parse(opDataSnapshotString.replace(/&quot;/g, '"'));
      state.blockedOps.push({ key: opKey, snapshot: opDataSnapshot });
    } catch (e) {
      console.error("Snapshot inválido para bloqueio:", e);
      state.blockedOps.push({ key: opKey, snapshot: { pair: opKey.split('-')[0] } });
    }
    
    if (favoriteIndex > -1) { 
      state.favoritedOps.splice(favoriteIndex, 1); 
      saveFavorites(); 
    } 
  } 
  saveBlockedOps(); 
  requestUiUpdate(); 
}

function unblockOpportunity(opKeyToUnblock) {
  if (!opKeyToUnblock) return;
  state.blockedOps = state.blockedOps.filter(blockedItem => blockedItem.key !== opKeyToUnblock);
  saveBlockedOps(); 
  requestUiUpdate(); 
}

function requestUiUpdate() {
  if (state.isPaused && uiUpdateScheduled) return;
  if (state.isPaused) return;
  if (!uiUpdateScheduled) {
    uiUpdateScheduled = true;
    setTimeout(updateAllUI, UI_UPDATE_INTERVAL_MS);
  }
}

function updateAllUI() { 
  uiUpdateScheduled = false; 
  updateGlobalUIState(); 
  renderPairsTable(); 
  renderOpportunitiesTable(); 
  renderBlockedOpportunitiesTable(); 
  renderWatchedPairsTable();
  updateMainTitle();
}

function updateGlobalUIState() {
    if (elements.connectionDot && elements.connectionText) {
        if (state.connected) {
            elements.connectionDot.className = 'status-dot connected';
            elements.connectionText.textContent = 'Conectado';
        } else {
            elements.connectionDot.className = 'status-dot disconnected';
            elements.connectionText.textContent = 'Desconectado';
        }
    }

    if (state.lastUpdated && elements.lastUpdated) {
        elements.lastUpdated.textContent = 'Última atualização: ' + state.lastUpdated.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    if (state.config && state.config.exchanges) {
        if (state.config.exchanges.mexc) {
            if (elements.mexcSpotFee) elements.mexcSpotFee.textContent = (parseFloat(state.config.exchanges.mexc.spotMakerFee) * 100).toFixed(4);
            if (elements.mexcFuturesFee) elements.mexcFuturesFee.textContent = (parseFloat(state.config.exchanges.mexc.futuresMakerFee) * 100).toFixed(4);
        }
        if (state.config.exchanges.gateio) {
            if (elements.gateioSpotFee) elements.gateioSpotFee.textContent = (parseFloat(state.config.exchanges.gateio.spotMakerFee) * 100).toFixed(4);
            if (elements.gateioFuturesFee) elements.gateioFuturesFee.textContent = (parseFloat(state.config.exchanges.gateio.futuresMakerFee) * 100).toFixed(4);
        }
    }
    if (elements.minProfit && state.config && state.config.arbitrage) {
        elements.minProfit.textContent = parseFloat(state.config.arbitrage.minProfitPercentage).toFixed(2);
    }

    updateSoundButton();
    updatePauseButton();
    updateThemeButton();

    if (defaultCapitalInputEl && document.activeElement !== defaultCapitalInputEl) {
        defaultCapitalInputEl.value = state.defaultCapitalUSD > 0 ? state.defaultCapitalUSD : '';
    }
}


function formatTimestamp(timestamp) { 
  if (!timestamp) return '-'; 
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); 
}

function formatPrice(price, decimals = 8) { 
  if (typeof price !== 'number' || isNaN(price)) return '-'; 
  return price.toFixed(decimals); 
}

function formatDirectProfitPercentage(value) { 
  if (value === null || value === undefined || typeof value !== 'number' || isNaN(value)) return '0.0000%'; 
  return (value >= 0 ? '+' : '') + value.toFixed(4) + '%'; 
}

function formatRatioAsProfitPercentage(ratioDecimal) { 
  if (ratioDecimal === null || typeof ratioDecimal !== 'number' || isNaN(ratioDecimal)) return 'N/A'; 
  const percentageValue = ratioDecimal * 100; 
  return (percentageValue >= 0 ? '+' : '') + percentageValue.toFixed(4) + '%'; 
}

function formatTimeAgo(timestamp) { 
  if (!timestamp) return "N/A"; 
  const diff = Date.now() - timestamp; 
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function getCurrencyIcon(pair) { 
  if (!pair || typeof pair !== 'string') return '<div class="currency-icon">?</div>'; 
  const base = pair.split('/')[0].substring(0,3).toUpperCase(); 
  return `<div class="currency-icon" title="${base}">${base.substring(0,1)}</div>`; 
}

function formatVolume24hForDisplay(valueInUSDT) { 
  if (valueInUSDT === null || typeof valueInUSDT !== 'number' || isNaN(valueInUSDT)) return 'N/A'; 
  if (valueInUSDT === 0) return "0K"; 
  if (valueInUSDT >= 1000000) return `${(valueInUSDT / 1000000).toFixed(1)}M`; 
  if (valueInUSDT >= 1000) return `${(valueInUSDT / 1000).toFixed(0)}K`; 
  return `${valueInUSDT.toFixed(0)}`; 
}

function getExchangeTag(exchangeName) { 
  if (!exchangeName) return ''; 
  const nameLower = exchangeName.toLowerCase(); 
  if (nameLower !== 'mexc' && nameLower !== 'gateio') return `<span class="exchange-tag" title="${exchangeName}">${nameLower.substring(0,4)}</span>`; 
  return `<span class="exchange-tag ${nameLower}" title="${exchangeName}">${nameLower.substring(0,4)}</span>`; 
}

function calculateLucroS(op, allMarketData, config) { 
  if (!op || !allMarketData || !config || !config.exchanges) return null; 
  const { buyExchange, sellExchange, buyInstrument, sellInstrument, pair } = op; 
  const buyExLower = buyExchange.toLowerCase(); 
  const sellExLower = sellExchange.toLowerCase(); 
  const marketDataForSellExit = allMarketData.find(p => p.exchange.toLowerCase() === buyExLower && p.pair === pair); 
  const marketDataForBuyExit = allMarketData.find(p => p.exchange.toLowerCase() === sellExLower && p.pair === pair); 
  if (!marketDataForSellExit || !marketDataForBuyExit) return null; 
  const configSellExit = config.exchanges[buyExLower]; 
  const configBuyExit = config.exchanges[sellExLower]; 
  if (!configSellExit || !configBuyExit) return null; 
  let priceToSellForExit, feeForSellExit; 
  let buyInst = (buyInstrument || '').toUpperCase();
  if (buyInst === "PONTO") buyInst = "SPOT";
  if (buyInst === "FUTUROS") buyInst = "FUTURES";

  if (buyInst === "SPOT") { 
    priceToSellForExit = marketDataForSellExit.spotBid; 
    feeForSellExit = parseFloat(configSellExit.spotMakerFee); 
  } else { 
    priceToSellForExit = marketDataForSellExit.futuresBid; 
    feeForSellExit = parseFloat(configSellExit.futuresMakerFee); 
  } 
  
  let priceToBuyForExit, feeForBuyExit; 
  let sellInst = (sellInstrument || '').toUpperCase();
  if (sellInst === "PONTO") sellInst = "SPOT";
  if (sellInst === "FUTUROS") sellInst = "FUTURES";

  if (sellInst === "SPOT") { 
    priceToBuyForExit = marketDataForBuyExit.spotPrice; 
    feeForBuyExit = parseFloat(configBuyExit.spotMakerFee); 
  } else { 
    priceToBuyForExit = marketDataForBuyExit.futuresPrice; 
    feeForBuyExit = parseFloat(configBuyExit.futuresMakerFee); 
  } 
  if (typeof priceToBuyForExit !=='number' || isNaN(priceToBuyForExit) || priceToBuyForExit <= 0 || typeof priceToSellForExit !=='number' || isNaN(priceToSellForExit) || isNaN(feeForBuyExit) || isNaN(feeForSellExit)) return null; 
  const grossSpreadExitDecimal = (priceToSellForExit / priceToBuyForExit) - 1; 
  const netSpreadDecimal = grossSpreadExitDecimal - feeForSellExit - feeForBuyExit; 
  return netSpreadDecimal * 100; 
}

function renderPairsTable() {
  if(!pairCountMonitorEl || !pairsTableBodyEl) return; 
  
  const visiblePairsData = state.allPairsData;
  pairCountMonitorEl.textContent = visiblePairsData.length; 

  if (visiblePairsData.length === 0) {
    pairsTableBodyEl.innerHTML = `<tr><td colspan="8" class="no-data">Aguardando dados dos pares...</td></tr>`;
  } else {
    const sortedPairsData = [...visiblePairsData].sort((a,b)=> { 
      const exComp = (a.exchange||"").localeCompare(b.exchange||""); 
      if (exComp !== 0) return exComp; 
      return (a.pair||"").localeCompare(b.pair||""); 
    });
    pairsTableBodyEl.innerHTML = sortedPairsData.map(pD=> {
      return `<tr>
        <td>${getExchangeTag(pD.exchange)}</td>
        <td class="pair-cell">${escapeHTML(pD.pair)||"N/A"}</td>
        <td class="price-cell">${formatPrice(pD.spotPrice)}</td>
        <td class="price-cell">${formatPrice(pD.futuresPrice)}</td>
        <td class="price-cell">${formatPrice(pD.spotBid)}</td>
        <td class="price-cell">${formatPrice(pD.futuresBid)}</td>
        <td>${formatTimestamp(pD.spotTimestamp)}</td>
        <td>${formatTimestamp(pD.futuresTimestamp)}</td>
      </tr>`;
    }).join('');
  }
}

function renderWatchedPairsTable() {
    const watchedPairsTableBodyEl = document.getElementById('watched-pairs-table-body');
    if (!watchedPairsTableBodyEl) return;

    if (state.watchedPairsList.length === 0) {
        watchedPairsTableBodyEl.innerHTML = `<tr><td colspan="8" class="no-data">Adicione um par acima para vigiá-lo em tempo real.</td></tr>`;
        return;
    }

    let tableHtml = "";
    let combinationsFound = 0;
    
    state.watchedPairsList.forEach(pair => {
        const opportunitiesForPair = state.arbitrageOpportunities.filter(opWrapper => {
            const op = opWrapper.data;
            if (op.pair !== pair) return false;

            const opKey = `${op.pair}|${op.direction}`;
            if (state.tempHiddenWatchedOps.has(opKey)) {
                return false;
            }

            const isFutFut = (op.buyInstrument?.toLowerCase().includes('futur')) && (op.sellInstrument?.toLowerCase().includes('futur'));
            const isSpotSpot = (op.buyInstrument?.toLowerCase().includes('spot')) && (op.sellInstrument?.toLowerCase().includes('spot'));
            if (isFutFut && !state.config.arbitrage.enableFuturesVsFutures) return false;
            if (isSpotSpot && !state.config.arbitrage.enableSpotVsSpot) return false;

            const buyExchange = op.buyExchange?.toLowerCase();
            const sellExchange = op.sellExchange?.toLowerCase();
            const buyMarket = op.buyInstrument?.toLowerCase();
            const sellMarket = op.sellInstrument?.toLowerCase();
            
            let buyAllowed = false;
            let sellAllowed = false;
            
            if (buyExchange === 'mexc' && (buyMarket === 'spot' || buyMarket === 'ponto') && state.filters.mexcSpot) buyAllowed = true;
            else if (buyExchange === 'mexc' && (buyMarket === 'futures' || buyMarket === 'futuros') && state.filters.mexcFutures) buyAllowed = true;
            else if (buyExchange === 'gateio' && (buyMarket === 'spot' || buyMarket === 'ponto') && state.filters.gateioSpot) buyAllowed = true;
            else if (buyExchange === 'gateio' && (buyMarket === 'futures' || buyMarket === 'futuros') && state.filters.gateioFutures) buyAllowed = true;
            
            if (sellExchange === 'mexc' && (sellMarket === 'spot' || sellMarket === 'ponto') && state.filters.mexcSpot) sellAllowed = true;
            else if (sellExchange === 'mexc' && (sellMarket === 'futures' || sellMarket === 'futuros') && state.filters.mexcFutures) sellAllowed = true;
            else if (sellExchange === 'gateio' && (sellMarket === 'spot' || sellMarket === 'ponto') && state.filters.gateioSpot) sellAllowed = true;
            else if (sellExchange === 'gateio' && (sellMarket === 'futures' || sellMarket === 'futuros') && state.filters.gateioFutures) sellAllowed = true;
            
            return buyAllowed && sellAllowed;
        });

        if (opportunitiesForPair.length > 0) {
            combinationsFound += opportunitiesForPair.length;
            opportunitiesForPair.forEach(opWrapper => {
                const op = opWrapper.data;
                const lucroE_percent = op.netSpreadPercentage;
                const lucroS_percent = calculateLucroS(op, state.allPairsData, state.config);
                const lucroEClass = lucroE_percent >= 0 ? 'profit-positive' : 'profit-negative';
                const lucroSClass = lucroS_percent === null ? 'profit-zero' : (lucroS_percent >= 0 ? 'profit-positive' : 'profit-negative');
                const opKey = `${op.pair}|${op.direction}`;

                let volumeDisplay, fundingRateDisplay, fundingRateClass = 'profit-zero';
                 if (op.type === "INTER_EXCHANGE_FUT_FUT") {
                    const volBuy = formatVolume24hForDisplay(op.futuresVolume24hUSD_buyLeg);
                    const volSell = formatVolume24hForDisplay(op.futuresVolume24hUSD_sellLeg);
                    volumeDisplay = `${volBuy} / ${volSell}`;
                    fundingRateDisplay = formatRatioAsProfitPercentage(op.fundingRate_sellLeg);
                    fundingRateClass = (op.fundingRate_sellLeg || 0) >= 0 ? 'profit-positive' : 'profit-negative';
                } else if (op.type === "INTER_EXCHANGE_SPOT_SPOT") {
                    const volBuy = formatVolume24hForDisplay(op.spotVolume24hUSD_buyLeg);
                    const volSell = formatVolume24hForDisplay(op.spotVolume24hUSD_sellLeg);
                    volumeDisplay = `${volBuy} / ${volSell}`;
                    fundingRateDisplay = 'N/A';
                } else {
                    volumeDisplay = `${formatVolume24hForDisplay(op.spotVolume24hUSD)} / ${formatVolume24hForDisplay(op.futuresVolume24hUSD)}`;
                    fundingRateDisplay = formatRatioAsProfitPercentage(op.fundingRate);
                    fundingRateClass = (op.fundingRate || 0) >= 0 ? 'profit-positive' : 'profit-negative';
                }

                const escapedPair = escapeHTML(pair);
                const timeAgo = formatTimeAgo(op.timestamp);

                tableHtml += `
                    <tr>
                        <td class="pair-cell">
                            <button class="remove-watched-pair" data-op-key="${escapeHTML(opKey)}" title="Ocultar esta combinação">&times;</button>
                            ${getCurrencyIcon(pair)}
                            ${escapedPair}
                        </td>
                        <td><div class="exchange-link">${getExchangeTag(op.buyExchange)} ${op.buyInstrument}<span>${formatPrice(op.buyPrice)}</span></div></td>
                        <td><div class="exchange-link">${getExchangeTag(op.sellExchange)} ${op.sellInstrument}<span>${formatPrice(op.sellPrice)}</span></div></td>
                        <td><div class="profit-cell ${lucroEClass}">${formatDirectProfitPercentage(lucroE_percent)}</div></td>
                        <td><div class="profit-cell ${lucroSClass}">${formatDirectProfitPercentage(lucroS_percent)}</div></td>
                        <td><div class="volume-cell">${volumeDisplay}</div></td>
                        <td><div class="funding-cell ${fundingRateClass}">${fundingRateDisplay}</div></td>
                        <td><div class="time-cell">${timeAgo}</div></td>
                    </tr>
                `;
            });
        }
    });

    if (combinationsFound === 0 && state.watchedPairsList.length > 0) {
        tableHtml = `<tr><td colspan="8" class="no-data">Nenhuma combinação visível para os pares vigiados com os filtros atuais.</td></tr>`;
    }

    watchedPairsTableBodyEl.innerHTML = tableHtml;
    
    document.querySelectorAll('.remove-watched-pair').forEach(button => { 
        button.addEventListener('click', function() { 
            const keyToHide = this.dataset.opKey; 
            state.tempHiddenWatchedOps.add(keyToHide);
            requestUiUpdate();
        }); 
    });
}


function renderOpportunitiesTable() {
    if (!opportunitiesTableBodyEl || !elements.viewTitle) return;

    const filteredOpWrappers = getFilteredOpportunities();
    const currentDefaultCapital = state.defaultCapitalUSD;
    
    const favoritedOpWrappers = filteredOpWrappers.filter(opWrapper => {
        const opKey = `${opWrapper.data.pair}-${opWrapper.data.direction}`;
        return state.favoritedOps.includes(opKey);
    });
    const normalOpWrappers = filteredOpWrappers.filter(opWrapper => {
        const opKey = `${opWrapper.data.pair}-${opWrapper.data.direction}`;
        return !state.favoritedOps.includes(opKey);
    });

    const sortFunction = (a, b) => {
        if (state.sortColumn === 'lucroS') {
            const aVal = calculateLucroS(a.data, state.allPairsData, state.config) || -Infinity;
            const bVal = calculateLucroS(b.data, state.allPairsData, state.config) || -Infinity;
            return state.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
        
        const aVal = a.data[state.sortColumn];
        const bVal = b.data[state.sortColumn];
        
        if (state.sortColumn === 'firstSeen') {
            const aTime = a.firstSeen || 0;
            const bTime = b.firstSeen || 0;
            return state.sortDirection === 'asc' ? aTime - bTime : bTime - aTime;
        }
        
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return state.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
        
        const aStr = String(aVal || '');
        const bStr = String(bVal || '');
        return state.sortDirection === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    };

    [favoritedOpWrappers, normalOpWrappers].forEach(arr => arr.sort(sortFunction));

    const finalSortedOpportunities = [...favoritedOpWrappers, ...normalOpWrappers];
    let finalOpportunitiesToRender = finalSortedOpportunities.slice(0, state.maxOpportunitiesToShow);

    if (finalOpportunitiesToRender.length === 0) {
        const message = state.currentView === 'arbitragens' ?
            'Aguardando oportunidades de arbitragem com lucro de entrada positivo...' :
            'Nenhuma oportunidade com lucro de saída positivo encontrada no momento.';

        opportunitiesTableBodyEl.innerHTML = `<tr><td colspan="10" class="no-data">${message}</td></tr>`;
        updateSortArrows();
        state.soundPlayedForVisibleOps.clear();
        return;
    }

    let tableHtml = "";
    
    finalOpportunitiesToRender.forEach((opWrapper) => {
        const op = opWrapper.data;
        const { firstSeen } = opWrapper;
        const opKey = `${op.pair}-${op.direction}`;
        const isFavorited = state.favoritedOps.includes(opKey);

        let profitForAlarm = null;
        if (state.currentView === 'saida-op') {
            profitForAlarm = calculateLucroS(op, state.allPairsData, state.config);
        } else {
            profitForAlarm = op.netSpreadPercentage;
        }

        if (typeof profitForAlarm === 'number' && profitForAlarm >= state.soundProfitThreshold) {
            if (!state.soundPlayedForVisibleOps.has(opKey)) {
                playSoundNotification();
                state.soundPlayedForVisibleOps.add(opKey);
            }
        }

        const lucroE_value_as_percentage = op.netSpreadPercentage;
        const lucroS_percent = calculateLucroS(op, state.allPairsData, state.config);
        const lucroEClass = lucroE_value_as_percentage >= 0 ? 'profit-positive' : 'profit-negative';
        const lucroSClass = lucroS_percent === null ? 'profit-zero' : (lucroS_percent >= 0 ? 'profit-positive' : 'profit-negative');

        let volumeDisplay, fundingRateDisplay, fundingRateClass = 'profit-zero';
        if (op.type === "INTER_EXCHANGE_FUT_FUT") {
            const volBuy = formatVolume24hForDisplay(op.futuresVolume24hUSD_buyLeg);
            const volSell = formatVolume24hForDisplay(op.futuresVolume24hUSD_sellLeg);
            volumeDisplay = `${volBuy} / ${volSell}`;
            fundingRateDisplay = formatRatioAsProfitPercentage(op.fundingRate_sellLeg);
            fundingRateClass = (op.fundingRate_sellLeg || 0) >= 0 ? 'profit-positive' : 'profit-negative';
        } else if (op.type === "INTER_EXCHANGE_SPOT_SPOT") {
            const volBuy = formatVolume24hForDisplay(op.spotVolume24hUSD_buyLeg);
            const volSell = formatVolume24hForDisplay(op.spotVolume24hUSD_sellLeg);
            volumeDisplay = `${volBuy} / ${volSell}`;
            fundingRateDisplay = 'N/A';
            fundingRateClass = 'profit-zero';
        } else {
            volumeDisplay = `${formatVolume24hForDisplay(op.spotVolume24hUSD)} / ${formatVolume24hForDisplay(op.futuresVolume24hUSD)}`;
            fundingRateDisplay = formatRatioAsProfitPercentage(op.fundingRate);
            fundingRateClass = (op.fundingRate || 0) >= 0 ? 'profit-positive' : 'profit-negative';
        }

        const baseAsset = op.pair ? op.pair.split('/')[0] : '';
        let qtdSugeridaBase = 0;
        if (currentDefaultCapital > 0 && op.buyPrice > 0) {
            qtdSugeridaBase = arredondarQuantidadeSugerida(currentDefaultCapital / op.buyPrice);
        }

        const opDataForSnapshot = JSON.stringify(op).replace(/"/g, "&quot;");
        const escapedPair = escapeHTML(op.pair);
        const escapedDirection = escapeHTML(op.direction);
        const escapedBuyEx = escapeHTML(op.buyExchange);
        const escapedBuyInst = escapeHTML(op.buyInstrument);
        const escapedSellEx = escapeHTML(op.sellExchange);
        const escapedSellInst = escapeHTML(op.sellInstrument);
        const escapedOpKey = escapeHTML(opKey);
        
        const escapedOpDataForCopy = JSON.stringify(op).replace(/"/g, '&quot;');
        const openAllClickHandler = `abrirGraficosComLayout('${escapedBuyEx}', '${escapedBuyInst}', '${escapedSellEx}', '${escapedSellInst}', '${escapedPair}', '${escapedDirection}', '${escapedOpDataForCopy}')`;
        
        const openAllIcon = `<svg onclick="${openAllClickHandler}" class="open-exchange-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" title="Abrir gráficos, calculadora E copiar qtd. sugerida"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
        
        const compraLink = `<a href="#" class="exchange-link" onclick="window.open(getExchangeUrl('${escapedBuyEx}', '${escapedBuyInst}', '${escapedPair}'), '_blank'); return false;">${getExchangeTag(op.buyExchange)} ${op.buyInstrument}<span>${formatPrice(op.buyPrice)}</span></a>`;
        const vendaLink = `<a href="#" class="exchange-link" onclick="window.open(getExchangeUrl('${escapedSellEx}', '${escapedSellInst}', '${escapedPair}'), '_blank'); return false;">${getExchangeTag(op.sellExchange)} ${op.sellInstrument}<span>${formatPrice(op.sellPrice)}</span></a>`;
        
        const calculatorIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="calculator-icon" onclick="abrirCalculadora('${escapedPair}', '${escapedDirection}', '${escapedBuyEx}', '${escapedSellEx}')" title="Abrir Calculadora Detalhada"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="14" x2="16" y2="18"></line><line x1="16" y1="10" x2="16" y2="10"></line><line x1="12" y1="10" x2="12" y2="10"></line><line x1="8" y1="10" x2="8" y2="10"></line><line x1="12" y1="14" x2="12" y2="18"></line><line x1="8" y1="14" x2="8" y2="18"></line></svg>`;

        tableHtml += `<tr>
      <td class="pair-cell">
        <span onclick="toggleFavorite('${escapedOpKey}')" class="favorite-star ${isFavorited ? 'favorited' : 'not-favorited'}" title="${isFavorited ? 'Desfavoritar' : 'Favoritar'}">${isFavorited ? '★' : '☆'}</span>
        <span onclick="toggleBlock('${escapedOpKey}', '${opDataForSnapshot}')" class="block-icon not-blocked" title="Bloquear">🚫</span>
        ${openAllIcon}
        ${getCurrencyIcon(op.pair)}
        ${escapeHTML(op.pair) || 'N/A'}
      </td>
      <td>${compraLink}</td>
      <td>${vendaLink}</td>
      <td><div class="profit-cell ${lucroEClass}">${formatDirectProfitPercentage(lucroE_value_as_percentage)}</div></td>
      <td><div class="profit-cell ${lucroSClass}">${formatDirectProfitPercentage(lucroS_percent)}</div></td>
      <td><div class="volume-cell">${volumeDisplay}</div></td>
      <td><div class="funding-cell ${fundingRateClass}">${fundingRateDisplay}</div></td>
      <td class="qty-cell" title="Qtd. de ${escapeHTML(baseAsset)} para ${currentDefaultCapital.toLocaleString()} USD">${qtdSugeridaBase > 0 ? `${qtdSugeridaBase.toLocaleString()} <button onclick="copiarParaClipboard('${qtdSugeridaBase}', this)">📋</button>` : '-'}</td>
      <td><div class="time-cell">${formatTimeAgo(firstSeen)}</div></td>
      <td class="action-cell">
        ${calculatorIcon}
      </td>
    </tr>`;
    });

    opportunitiesTableBodyEl.innerHTML = tableHtml;
    updateSortArrows();
    
    state.soundPlayedForVisibleOps.forEach(playedOpKey => {
        if (!finalOpportunitiesToRender.some(opWrapper => `${opWrapper.data.pair}-${opWrapper.data.direction}` === playedOpKey)) {
            state.soundPlayedForVisibleOps.delete(playedOpKey);
        }
    });
}

function renderBlockedOpportunitiesTable() {
  if (!blockedOpsTableBodyEl || !blockedOpsCountEl) return;
  blockedOpsCountEl.textContent = state.blockedOps.length;
  if (state.blockedOps.length === 0) {
    blockedOpsTableBodyEl.innerHTML = `<tr><td colspan="8" class="no-data">Nenhuma oportunidade bloqueada.</td></tr>`;
    return;
  }
  const sortedBlockedOps = [...state.blockedOps].sort((a, b) => 
    (a.snapshot?.pair || a.key).localeCompare(b.snapshot?.pair || b.key)
  );
  blockedOpsTableBodyEl.innerHTML = sortedBlockedOps.map(blockedOpItem => {
    const { snapshot, key: opKey } = blockedOpItem;
    const liveOpWrapper = state.arbitrageOpportunities.find(opw => (opw.data.pair + '-' + opw.data.direction) === opKey);
    const liveData = liveOpWrapper ? liveOpWrapper.data : null;
    let lucroE_display = "N/A", lucroS_display = "N/A";
    let lucroEClass = "profit-zero", lucroSClass = "profit-zero";
    if (liveData) {
      lucroE_display = formatDirectProfitPercentage(liveData.netSpreadPercentage);
      lucroEClass = liveData.netSpreadPercentage >= 0 ? 'profit-positive' : 'profit-negative';
      const lucroS_val = calculateLucroS(liveData, state.allPairsData, state.config);
      lucroS_display = formatDirectProfitPercentage(lucroS_val);
      lucroSClass = lucroS_val === null ? 'profit-zero' : (lucroS_val >= 0 ? 'profit-positive' : 'profit-negative');
    }
    return `
      <tr>
        <td class="pair-cell">${getCurrencyIcon(snapshot.pair || '')} ${escapeHTML(snapshot.pair)}</td>
        <td>${getExchangeTag(snapshot.buyExchange)} ${snapshot.buyInstrument}<span>${formatPrice(snapshot.buyPrice)}</span></td>
        <td>${getExchangeTag(snapshot.sellExchange)} ${snapshot.sellInstrument}<span>${formatPrice(snapshot.sellPrice)}</span></td>
        <td><div class="profit-cell ${lucroEClass}">${lucroE_display}</div></td>
        <td><div class="profit-cell ${lucroSClass}">${lucroS_display}</div></td>
        <td>...</td>
        <td>...</td>
        <td class="action-cell">
          <button class="rehab-button" onclick="unblockOpportunity('${escapeHTML(opKey)}')">Reabilitar</button>
        </td>
      </tr>
    `;
  }).join('');
}

function sortByColumn(columnKey) { 
  if (state.sortColumn === columnKey) { 
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc'; 
  } else { 
    state.sortColumn = columnKey; 
    state.sortDirection = (['netSpreadPercentage', 'lucroS', 'volume', 'fundingRate'].includes(columnKey)) ? 'desc' : 'asc'; 
  } 
  requestUiUpdate(); 
}

function updateSortArrows() { 
  document.querySelectorAll('.sort-arrow').forEach(el => {
    el.innerHTML = '▼';
    el.classList.remove('active');
  });
  const arrowEl = document.getElementById(`sort-arrow-${state.sortColumn}`);
  if (arrowEl) {
    arrowEl.innerHTML = state.sortDirection === 'asc' ? '▲' : '▼'; 
    arrowEl.classList.add('active');
  }
}

function toggleWatchedPairs() {
  state.isWatchedPairsExpanded = !state.isWatchedPairsExpanded;
  if (watchedPairsTableContainerEl && watchedPairsToggleIconEl) {
    watchedPairsTableContainerEl.style.display = state.isWatchedPairsExpanded ? '' : 'none';
    watchedPairsToggleIconEl.innerHTML = state.isWatchedPairsExpanded ? ICON_EXPANDED : ICON_COLLAPSED;
    localStorage.setItem(WATCHED_PAIRS_EXPANDED_KEY, state.isWatchedPairsExpanded);
  }
}

function toggleMonitorPares() {
  state.isMonitorParesExpanded = !state.isMonitorParesExpanded;
  if (monitorParesTableContainerEl && monitorParesToggleIconEl) {
    monitorParesTableContainerEl.style.display = state.isMonitorParesExpanded ? '' : 'none';
    monitorParesToggleIconEl.innerHTML = state.isMonitorParesExpanded ? ICON_EXPANDED : ICON_COLLAPSED;
    localStorage.setItem(MONITOR_PARES_EXPANDED_KEY, state.isMonitorParesExpanded);
  }
}

function setupLogoutButton() {
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/users/logout', { method: 'POST' });
                if (response.ok) {
                    window.location.href = '/login.html';
                }
            } catch (error) {
                console.error('Erro ao fazer logout:', error);
            }
        });
    }
}

function connectWebSocket() { 
  let wsUrl = window.location.origin.replace(/^http/, 'ws'); 
  ws = new WebSocket(wsUrl); 
  ws.onopen = () => { 
      state.connected = true; 
      requestUiUpdate(); 
      ws.send(JSON.stringify({ type: 'request_latest_data' })); 
  }; 
  ws.onmessage = (event) => {
      try { 
        const message = JSON.parse(event.data);
        state.lastUpdated = new Date();
        let UINeedsUpdate = false;
        if (message.type === "opportunity") {
            const { data: opportunityData } = message;
            const now = Date.now();
            let opWrapper = state.arbitrageOpportunities.find(opW => opW.data.pair === opportunityData.pair && opW.data.direction === opportunityData.direction);
            if (opWrapper) {
                opWrapper.data = opportunityData;
                opWrapper.lastSignaled = opportunityData.timestamp || now;
            } else {
                state.arbitrageOpportunities.unshift({ data: opportunityData, firstSeen: now, lastSignaled: (opportunityData.timestamp || now) });
            }
            UINeedsUpdate = true;
        } else if (message.type === "opportunities") {
            const now = Date.now();
            state.arbitrageOpportunities = (message.data || []).map(oppData => ({ data: oppData, firstSeen: oppData.timestamp || now, lastSignaled: oppData.timestamp || now }));
            UINeedsUpdate = true;
        } else if (message.type === "all_pairs_update") {
            state.allPairsData = message.data || [];
            UINeedsUpdate = true;
        }
        if (UINeedsUpdate) requestUiUpdate();
    } catch (error) {
        console.error("FRONTEND: Erro msg WebSocket:", error, event.data);
    }
  }; 
  ws.onerror = () => { 
      state.connected = false; 
      requestUiUpdate();
  }; 
  ws.onclose = () => { 
      state.connected = false; 
      requestUiUpdate(); 
      setTimeout(connectWebSocket, 5000);
  }; 
}

function fetchConfigAndUpdateUI() { 
  fetch(`${window.location.origin}/api/config`) 
    .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP error ${res.status}`))) 
    .then(configData => {  
      Object.assign(state.config.exchanges.mexc, configData.exchanges?.mexc);
      Object.assign(state.config.exchanges.gateio, configData.exchanges?.gateio);
      Object.assign(state.config.arbitrage, configData.arbitrage);
      state.config.monitoredPairs = configData.monitoredPairs || [];
      if (filterEnableFutFutEl) filterEnableFutFutEl.checked = state.config.arbitrage.enableFuturesVsFutures;
      if (filterEnableSpotSpotEl) filterEnableSpotSpotEl.checked = state.config.arbitrage.enableSpotVsSpot;
      requestUiUpdate();
    }) 
    .catch(err => console.error("FRONTEND: Erro config API:", err)); 
}

function setupEventListeners() {
  if (elements.sidebarToggle) elements.sidebarToggle.addEventListener('click', toggleSidebar);
  if (elements.navArbitragens) elements.navArbitragens.addEventListener('click', () => setCurrentView('arbitragens'));
  if (elements.navSaidaOp) elements.navSaidaOp.addEventListener('click', () => setCurrentView('saida-op'));
  if (elements.navAmbosPositivos) elements.navAmbosPositivos.addEventListener('click', () => setCurrentView('ambos-positivos'));
  if (elements.toggleSoundButton) elements.toggleSoundButton.addEventListener('click', toggleSound);
  if (elements.themeToggleButton) elements.themeToggleButton.addEventListener('click', toggleTheme);
  if (elements.togglePauseButton) elements.togglePauseButton.addEventListener('click', () => { state.isPaused = !state.isPaused; updatePauseButton(); });
  if (elements.toggleBlockedOps) elements.toggleBlockedOps.addEventListener('click', toggleBlockedOps);
  
  Object.entries(filterCheckboxes).forEach(([key, checkbox]) => { if (checkbox) checkbox.addEventListener('change', (e) => { state.filters[e.target.dataset.filterkey] = e.target.checked; requestUiUpdate(); }); });
  
  if (filterMinVolumeInput) filterMinVolumeInput.addEventListener('input', (e) => { state.filters.minVolume = Number(e.target.value); requestUiUpdate(); });
  if (filterMinProfitEDisplayEl) filterMinProfitEDisplayEl.addEventListener('change', (e) => { state.filters.minProfitEFilterDisplay = Number(e.target.value); requestUiUpdate(); });
  if (filterMinProfitSDisplayEl) filterMinProfitSDisplayEl.addEventListener('change', (e) => { state.filters.minProfitSFilterDisplay = Number(e.target.value); requestUiUpdate(); });

  if (filterFundingMinInput) {
      filterFundingMinInput.addEventListener('input', (e) => {
          const value = e.target.value;
          state.filters.minFundingRate = value === '' ? null : parseFloat(value);
          requestUiUpdate();
      });
  }
  if (filterFundingMaxInput) {
      filterFundingMaxInput.addEventListener('input', (e) => {
          const value = e.target.value;
          state.filters.maxFundingRate = value === '' ? null : parseFloat(value);
          requestUiUpdate();
      });
  }

  if (filterEnableFutFutEl) {
      filterEnableFutFutEl.addEventListener('change', (e) => {
          state.config.arbitrage.enableFuturesVsFutures = e.target.checked; 
          requestUiUpdate();
          fetch('/api/config/arbitrage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enableFuturesVsFutures: e.target.checked }) })
          .catch(() => alert('Erro ao atualizar config no backend.'));
      });
  }
  if (filterEnableSpotSpotEl) {
      filterEnableSpotSpotEl.addEventListener('change', (e) => {
          state.config.arbitrage.enableSpotVsSpot = e.target.checked;
          requestUiUpdate();
          fetch('/api/config/arbitrage/spot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enableSpotVsSpot: e.target.checked }) })
          .catch(() => alert('Erro ao atualizar config no backend.'));
      });
  }
  
  if (addWatchPairButtonEl) addWatchPairButtonEl.addEventListener('click', addWatchedPair);
  if (watchPairInputEl) watchPairInputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') addWatchedPair(); });
  
  if (watchedPairsHeaderEl) watchedPairsHeaderEl.addEventListener('click', toggleWatchedPairs);
  if (monitorParesHeaderEl) monitorParesHeaderEl.addEventListener('click', toggleMonitorPares);
  
  if (defaultCapitalInputEl) defaultCapitalInputEl.addEventListener('input', () => { 
    let newCapital = parseFloat(defaultCapitalInputEl.value.trim());
    newCapital = isNaN(newCapital) || newCapital < 0 ? 0 : newCapital;
    state.defaultCapitalUSD = newCapital;
    localStorage.setItem(DEFAULT_CAPITAL_STORAGE_KEY, String(newCapital));
    requestUiUpdate(); 
  });
  
  if (soundProfitThresholdInputEl) soundProfitThresholdInputEl.addEventListener('input', () => { state.soundProfitThreshold = parseFloat(soundProfitThresholdInputEl.value) || 0; });
}

function init() {
  loadFavorites(); 
  loadBlockedOps(); 
  loadWatchedPairs();
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'light');
  
  const savedCapital = localStorage.getItem(DEFAULT_CAPITAL_STORAGE_KEY);
  state.defaultCapitalUSD = savedCapital ? parseFloat(savedCapital) : 0;
  if (defaultCapitalInputEl) defaultCapitalInputEl.value = state.defaultCapitalUSD > 0 ? state.defaultCapitalUSD : ''; 

  state.isWatchedPairsExpanded = localStorage.getItem(WATCHED_PAIRS_EXPANDED_KEY) === 'true'; 
  if (watchedPairsTableContainerEl && watchedPairsToggleIconEl) {
    watchedPairsTableContainerEl.style.display = state.isWatchedPairsExpanded ? '' : 'none';
    watchedPairsToggleIconEl.innerHTML = state.isWatchedPairsExpanded ? ICON_EXPANDED : ICON_COLLAPSED;
  }
  
  state.isMonitorParesExpanded = localStorage.getItem(MONITOR_PARES_EXPANDED_KEY) === 'true'; 
  if (monitorParesTableContainerEl && monitorParesToggleIconEl) {
    monitorParesTableContainerEl.style.display = state.isMonitorParesExpanded ? '' : 'none';
    monitorParesToggleIconEl.innerHTML = state.isMonitorParesExpanded ? ICON_EXPANDED : ICON_COLLAPSED;
  }
  
  if (soundProfitThresholdInputEl) soundProfitThresholdInputEl.value = state.soundProfitThreshold;
  
  setupEventListeners();
  setupLogoutButton();
  setCurrentView('arbitragens');
  fetchConfigAndUpdateUI();
  updateAllUI();
  
  connectWebSocket(); 
}

window.openExchangeTradingPage = (exchange, instrument, pair) => {
    const url = getExchangeUrl(exchange, instrument, pair);
    if (url) window.open(url, '_blank');
};
window.toggleFavorite = toggleFavorite;
window.toggleBlock = toggleBlock;
window.unblockOpportunity = unblockOpportunity;
window.sortByColumn = sortByColumn;
window.copiarParaClipboard = copiarParaClipboard;
window.abrirGraficosComLayout = abrirGraficosComLayout;
window.abrirCalculadora = abrirCalculadora;

document.addEventListener('DOMContentLoaded', init);