let pair = '';
let originalDirection = '';
let entryBuyExName = 'mexc';
let entrySellExName = 'mexc';
let entryBuyInstrumentIsSpot = true;
let entrySellInstrumentIsSpot = false;
let initialBuyPrice = 0;
let initialSellPrice = 0;

const popupPairDisplayEl = document.getElementById('popupPairDisplay');
const popupLeg1ExchangeEl = document.getElementById('popupLeg1Exchange');
const popupLeg1InstrumentEl = document.getElementById('popupLeg1Instrument');
const popupLeg1PriceEl = document.getElementById('popupLeg1Price');
const popupProfitEEl = document.getElementById('popupProfitE');
const popupProfitSEl = document.getElementById('popupProfitS');
const popupLeg2ExchangeEl = document.getElementById('popupLeg2Exchange');
const popupLeg2InstrumentEl = document.getElementById('popupLeg2Instrument');
const popupLeg2PriceEl = document.getElementById('popupLeg2Price');
let lastUpdateTime = 0;

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
  let textToShow = "Dados...";
  let baseClassName = element.id === 'popupProfitS' ? 'value-s profit-value' : 'value profit-value';
  let finalClassName = `${baseClassName} zero`;

  if (typeof profitPercentage === 'number' && !isNaN(profitPercentage)) {
    textToShow = (profitPercentage > 0 ? "+" : "") + profitPercentage.toFixed(2) + "%";
    finalClassName = `${baseClassName} ${profitPercentage > 0 ? 'positive' : profitPercentage < 0 ? 'negative' : 'zero'}`;
  }
  element.textContent = textToShow;
  element.className = finalClassName;
}

async function fetchLatestPrices(pair, buyEx, sellEx) {
  // Substitua por chamada real (ex.: WebSocket ou API)
  return [Math.random() * 100, Math.random() * 100]; // Simulação
}

function updateDisplay(buyPrice, sellPrice) {
  popupLeg1PriceEl.textContent = formatPriceForDisplay(buyPrice);
  popupLeg2PriceEl.textContent = formatPriceForDisplay(sellPrice);

  const grossSpread = (sellPrice / buyPrice) - 1;
  const fees = { buy: 0.0001, sell: 0.0001 }; // Exemplo de taxas
  const netSpread = (grossSpread - fees.buy - fees.sell) * 100;
  formatProfitPercentageForDisplay(netSpread, popupProfitEEl);
  formatProfitPercentageForDisplay(-netSpread, popupProfitSEl); // Lucro inverso
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

  // Inicia WebSocket para dados em tempo real
  const ws = new WebSocket(`ws://${window.location.host}/market-updates`);
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'price_update' && data.pair === pair) {
      initialBuyPrice = data.buyPrice;
      initialSellPrice = data.sellPrice;
      updateDisplay(data.buyPrice, data.sellPrice);
    }
  };
  ws.onerror = (error) => console.error('WebSocket error:', error);

  // Atualização periódica otimizada
  window.profitUpdateInterval = setInterval(() => {
    requestAnimationFrame(() => {
      if (Date.now() - lastUpdateTime >= 250) {
        updateDisplay(initialBuyPrice, initialSellPrice);
        lastUpdateTime = Date.now();
      }
    });
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
        { buyPrice: initialBuyPrice, sellPrice: initialSellPrice }
      );
    }
  });

  window.addEventListener('beforeunload', () => {
    if (window.profitUpdateInterval) clearInterval(window.profitUpdateInterval);
    if (ws) ws.close();
  });
};