document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const pair = params.get("pair");
    const direction = params.get("direction");
    const buyEx = params.get("buyEx");
    const sellEx = params.get("sellEx");
    // Precisamos do 'instrument' para a função de abrir gráficos funcionar
    const buyInst = params.get("buyInst") || (direction.toLowerCase().includes('spot') ? 'spot' : 'futures');
    const sellInst = params.get("sellInst") || (direction.toLowerCase().includes('spot') ? 'futures' : 'spot');

    if (!pair) {
        document.body.innerHTML = "<h1>Erro: Par não especificado.</h1>";
        return;
    }

    document.title = "Entrada: " + pair;
    const popupPairDisplayEl = document.getElementById("popupPairDisplay");
    if (popupPairDisplayEl) popupPairDisplayEl.textContent = pair.split("/")[0];

    const openChartButtonEl = document.getElementById("openChartButton");
    if (openChartButtonEl) {
        openChartButtonEl.addEventListener("click", () => {
            if (window.opener && typeof window.opener.abrirGraficosComLayout === "function") {
                window.opener.abrirGraficosComLayout(buyEx, buyInst, sellEx, sellInst, pair, direction, '');
            }
        });
    }

    // Função para atualizar a UI com os novos dados recebidos
    function updateUI(data) {
        const { opportunity, lucroS } = data;
        const elements = {
            leg1Ex: document.getElementById("popupLeg1Exchange"),
            leg1Inst: document.getElementById("popupLeg1Instrument"),
            leg1Price: document.getElementById("popupLeg1Price"),
            profitE: document.getElementById("popupProfitE"),
            profitS: document.getElementById("popupProfitS"),
            leg2Ex: document.getElementById("popupLeg2Exchange"),
            leg2Inst: document.getElementById("popupLeg2Instrument"),
            leg2Price: document.getElementById("popupLeg2Price")
        };

        elements.leg1Ex.textContent = opportunity.buyExchange.substring(0, 4).toUpperCase();
        elements.leg1Inst.textContent = opportunity.buyInstrument.toUpperCase().includes("SPOT") ? "S" : "F";
        elements.leg1Price.textContent = formatPrice(opportunity.buyPrice);

        elements.leg2Ex.textContent = opportunity.sellExchange.substring(0, 4).toUpperCase();
        elements.leg2Inst.textContent = opportunity.sellInstrument.toUpperCase().includes("SPOT") ? "S" : "F";
        elements.leg2Price.textContent = formatPrice(opportunity.sellPrice);

        formatProfit(opportunity.netSpreadPercentage, elements.profitE);
        formatProfit(lucroS, elements.profitS);
    }

    // Funções de formatação
    function formatPrice(price) {
        if (typeof price !== "number" || isNaN(price)) return "...";
        const decimals = Math.abs(price) >= 1 ? 4 : 7;
        return price.toFixed(decimals);
    }

    function formatProfit(value, element) {
        if (!element) return;
        let text = "---";
        let className = "zero";

        if (typeof value === "number" && !isNaN(value)) {
            text = (value >= 0 ? "+" : "") + value.toFixed(2) + "%";
            if (value > 0.009) className = "positive";
            else if (value < -0.009) className = "negative";
        }
        
        const baseClass = element.id === 'popupProfitS' ? 'value-s' : 'value';
        element.textContent = text;
        element.className = `${baseClass} profit-value ${className}`;
    }

    // Escuta as mensagens da janela principal
    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;

        const { type, ...data } = event.data;
        if (type === 'update') {
            updateUI(data);
        }
    });
});