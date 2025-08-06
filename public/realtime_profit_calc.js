let pair = '';
let originalDirection = '';
let entryBuyExName = 'mexc';
let entrySellExName = 'mexc';
let entryBuyInstrumentIsSpot = true;
let entrySellInstrumentIsSpot = false;
let initialBuyPrice = 0;
let initialSellPrice = 0;
let lastUpdateTime = 0;

const popupPairDisplayEl = document.getElementById('popupPairDisplay');
const popupLeg1ExchangeEl = document.getElementById('popupLeg1Exchange');
const popupLeg1InstrumentEl = document.getElementById('popupLeg1Instrument');
const popupLeg1PriceEl = document.getElementById('popupLeg1Price');
const popupProfitEEl = document.getElementById('popupProfitE');
const popupProfitSEl = document.getElementById('popupProfitS');
const popupLeg2ExchangeEl = document.getElementById('popupLeg2Exchange');
const popupLeg2InstrumentEl = document.getElementById('popupLeg2Instrument');
const popupLeg2PriceEl = document.getElementById('popupLeg2Price');
const openChartButtonEl = document.getElementById('openChartButton');

function formatPriceForDisplay(price, decimals = 7) {
  if (typeof price !== 'number' || isNaN(price)) return '-';
  if (price < 0.00001 && price !== 0 && price > -0.00001) return price.toPrecision(3);
  return price.toFixed(decimals);
}

function getRelevantDecimals(price) {
  if (price === null || price === undefined || isNaN(price)) return 7;
  const absPrice = Math.abs(price);
  if (absPrice >= 100) return 2;
  if (absPrice >= 1) return 4;
  if (absPrice >= 0.01) return 5;
  if (absPrice >= 0.0001) return 6;
  return 7;
}

function formatProfitPercentageForDisplay(profitPercentage, element) {
  if (!element) return;
  let textToShow = "Aguardando...";
  let baseClassName = element.id === 'popupProfitS' ? 'value-s profit-value' : 'value profit-value';
  let finalClassName = `${baseClassName} zero`;

  if (typeof profitPercentage === 'number' && !isNaN(profitPercentage)) {
    textToShow = (profitPercentage >= 0 ? "+" : "") + profitPercentage.toFixed(2) + "%";
    finalClassName = `${baseClassName} ${profitPercentage > 0 ? 'positive' : profitPercentage < 0 ? 'negative' : 'zero'}`;
  }
  element.textContent = textToShow;
  element.className = finalClassName;
}

function calculateProfit(buyPrice, sellPrice, buyFee, sellFee, direction) {
  let grossSpread = 0;
  if (direction.includes('spot/futures')) {
    grossSpread = (sellPrice / buyPrice) - 1;
  } else if (direction.includes('futures/spot')) {
    grossSpread = (buyPrice / sellPrice) - 1;
  }
  const netSpread = (grossSpread - buyFee - sellFee) * 100;
  return { entryProfit: netSpread, sellProfit: -netSpread };
}

async function fetchLatestPrices(pair, buyEx, sellEx) {
  // Placeholder - substitua por WebSocket ou API real
  return [initialBuyPrice || 100, initialSellPrice || 100.5]; // Valores iniciais fixos para teste
}

function updateDisplay(buyPrice, sellPrice) {
  popupLeg1PriceEl.textContent = formatPriceForDisplay(buyPrice);
  popupLeg2PriceEl.textContent = formatPriceForDisplay(sellPrice);

  const defaultFees = {
    mexc: { spotMakerFee: 0.0000, futuresMakerFee: 0.0001 },
    gateio: { spotMakerFee: 0.0010, futuresMakerFee: 0.0002 }
  };
  const buyExConfig = defaultFees[entryBuyExName.toLowerCase()] || { spotMakerFee: 0.001, futuresMakerFee: 0.001 };
  const sellExConfig = defaultFees[entrySellExName.toLowerCase()] || { spotMakerFee: 0.001, futuresMakerFee: 0.001 };
  const buyFee = entryBuyInstrumentIsSpot ? buyExConfig.spotMakerFee : buyExConfig.futuresMakerFee;
  const sellFee = entrySellInstrumentIsSpot ? sellExConfig.spotMakerFee : sellExConfig.futuresMakerFee;

  const { entryProfit, sellProfit } = calculateProfit(buyPrice, sellPrice, buyFee, sellFee, originalDirection);
  formatProfitPercentageForDisplay(entryProfit, popupProfitEEl);
  formatProfitPercentageForDisplay(sellProfit, popupProfitSEl);
}

window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  pair = params.get('pair') || '';
  originalDirection = params.get('direction') || '';
  entryBuyExName = params.get('buyEx') || 'mexc';
  entrySellExName = params.get('sellEx') || 'mexc';

  if (originalDirection) {
    const dirParts = originalDirection.toLowerCase().split('/');
    if (dirParts.length === 2) {
      entryBuyInstrumentIsSpot = dirParts[0].includes("spot");
      entrySellInstrumentIsSpot = dirParts[1].includes("spot");
    }
  }

  popupPairDisplayEl.textContent = pair;
  popupLeg1ExchangeEl.textContent = entryBuyExName;
  popupLeg1InstrumentEl.textContent = entryBuyInstrumentIsSpot ? 'Spot' : 'Futures';
  popupLeg2ExchangeEl.textContent = entrySellExName;
  popupLeg2InstrumentEl.textContent = entrySellInstrumentIsSpot ? 'Spot' : 'Futures';

  const ws = new WebSocket(`ws://${window.location.host}/market-updates`);
  ws.onopen = () => console.log('WebSocket connected');
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'price_update' && data.pair === pair) {
      console.log(`[Debug] Received - buy: ${data.buyPrice}, sell: ${data.sellPrice}`);
      initialBuyPrice = data.buyPrice || initialBuyPrice;
      initialSellPrice = data.sellPrice || initialSellPrice;
      requestAnimationFrame(() => updateDisplay(initialBuyPrice, initialSellPrice));
    }
  };
  ws.onerror = (error) => console.error('WebSocket error:', error);
  ws.onclose = () => console.log('WebSocket closed, attempting reconnect...');

  window.profitUpdateInterval = setInterval(() => {
    if (Date.now() - lastUpdateTime >= 250) {
      requestAnimationFrame(() => {
        fetchLatestPrices(pair, entryBuyExName, entrySellExName).then(([buyPrice, sellPrice]) => {
          if (buyPrice && sellPrice) {
            initialBuyPrice = buyPrice;
            initialSellPrice = sellPrice;
            updateDisplay(buyPrice, sellPrice);
            lastUpdateTime = Date.now();
          }
        }).catch(e => console.error('[CalcPopUpNew] Error fetching prices:', e));
      });
    }
  }, 250);

  openChartButtonEl.addEventListener('click', () => {
    if (window.opener && window.opener.abrirGraficosComLayout) {
      window.opener.abrirGraficosComLayout(
        entryBuyExName,
        entryBuyInstrumentIsSpot ? 'spot' : 'futures',
        entrySellExName,
        entrySellInstrumentIsSpot ? 'spot' : 'futures',
        pair,
        originalDirection,
        '',
        { buyPrice: initialBuyPrice, sellPrice: initialSellPrice, timestamp: Date.now() }
      );
    } else {
      console.warn("FRONTEND: window.opener ou abrirGraficosComLayout não disponível.");
    }
  });

  window.addEventListener('beforeunload', () => {
    if (window.profitUpdateInterval) clearInterval(window.profitUpdateInterval);
    if (ws) ws.close();
  });
};