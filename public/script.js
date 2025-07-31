```javascript
// script.js

// ... (código anterior)

function getFilteredOpportunities() {
    let opportunities = state.arbitrageOpportunities.filter(op => {
        // Filtra oportunidades que estão na lista de pares vigiados
        if (state.watchedPairsList.includes(op.data.pair)) return false; // Corrigido para op.data.pair

        // Filtra por exchange de compra (se selecionada)
        if (state.selectedBuyExchange && op.data.buyExchange !== state.selectedBuyExchange) return false; // Corrigido para op.data.buyExchange

        // Filtra por exchange de venda (se selecionada)
        if (state.selectedSellExchange && op.data.sellExchange !== state.selectedSellExchange) return false; // Corrigido para op.data.sellExchange

        // Filtra por spread líquido mínimo
        if (state.minNetSpreadPercentage && op.data.netSpreadPercentage < state.minNetSpreadPercentage) return false; // Corrigido para op.data.netSpreadPercentage

        // Filtra por percentual de entrada mínimo
        if (state.minEntryPercentage && op.data.entryPercentage < state.minEntryPercentage) return false; // Corrigido para op.data.entryPercentage

        // Filtra por percentual de saída mínimo
        if (state.minExitPercentage && op.data.exitPercentage < state.minExitPercentage) return false; // Corrigido para op.data.exitPercentage

        // Filtra por volume mínimo
        if (state.minVolume && op.data.minVolume < state.minVolume) return false; // Corrigido para op.data.minVolume

        // Filtra por financiamento máximo
        if (state.maxFinancing && op.data.maxFinancing > state.maxFinancing) return false; // Corrigido para op.data.maxFinancing

        return true;
    });

    // ... (restante da função)

    return opportunities;
}

// ... (restante do código)
```

