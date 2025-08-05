import { useEffect, useState } from 'react';
import './App.css';

// Tipos para as oportunidades de arbitragem
interface Opportunity {
  pair: string;
  direction: string;
  futuresPrice: number;
  spotPrice: number;
  grossSpreadPercentage: number;
  netSpreadPercentage: number;
  timestamp: number;
  volume: number;
  buyProfit: number;
  sellProfit: number;
}

function App() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [config, setConfig] = useState<any>({});
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    // Carregar configuração inicial
    fetch('/api/config')
      .then(response => response.json())
      .then(data => setConfig(data))
      .catch(error => console.error('Error fetching config:', error));

    // Carregar oportunidades iniciais
    fetch('/api/opportunities')
      .then(response => response.json())
      .then(data => {
        setOpportunities(data);
        if (data.length > 0) {
          setLastUpdated(new Date());
        }
      })
      .catch(error => console.error('Error fetching opportunities:', error));

    // Configurar WebSocket para atualizações em tempo real
    const ws = new WebSocket(`ws://${window.location.host}`);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'opportunity') {
        // Adicionar nova oportunidade à lista
        setOpportunities(prev => {
          const updatedOpportunities = prev.map(op => 
            (op.pair === message.data.pair && op.direction === message.data.direction) ? message.data : op
          );
          const newOpportunity = message.data;
          if (!updatedOpportunities.some(op => op.pair === newOpportunity.pair && op.direction === newOpportunity.direction)) {
            updatedOpportunities.unshift(newOpportunity);
          }
          return updatedOpportunities.filter(op => op.netSpreadPercentage >= (config.arbitrage?.min_profit_percentage || 0.0)).slice(0, 20);
        });
        setLastUpdated(new Date());
      } else if (message.type === 'opportunities') {
        // Atualizar lista completa
        setOpportunities(message.data);
        if (message.data.length > 0) {
          setLastUpdated(new Date());
        }
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    };
    
    return () => {
      ws.close();
    };
  }, []);

  // Formatar timestamp para tempo relativo (ex: "2m 30s")
  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  // Formatar volume para exibição mais legível
  const formatVolume = (volume: number) => {
    if (volume >= 1000000) return `${(volume / 1000000).toFixed(2)}M`;
    if (volume >= 1000) return `${(volume / 1000).toFixed(2)}K`;
    return volume.toFixed(2);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Arbitragens Disponíveis ({opportunities.length} Arbitragens)</h1>
        <p className="header-subtitle">
          Verifique os preços e os tokens antes de realizar a arbitragem.
          {lastUpdated && (
            <span className="last-updated">
              Última atualização: {lastUpdated.toLocaleTimeString()}
              {connected ? 
                <span className="connection-status connected">• Conectado</span> : 
                <span className="connection-status disconnected">• Desconectado</span>
              }
            </span>
          )}
        </p>
      </header>

      <div className="table-container">
        <table className="arbitrage-table">
          <thead>
            <tr>
              <th>PAR</th>
              <th>COMPRA SPOT</th>
              <th>VENDA FUTUROS</th>
              <th>LUCRO COMPRA</th>
              <th>LUCRO VENDA</th>
              <th>VOLUMES</th>
              <th>TEMPO</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan={7} className="no-data">Aguardando oportunidades de arbitragem...</td>
              </tr>
            ) : (
              opportunities.map((op, index) => (
                <tr key={`${op.pair}-${op.direction}-${index}`}>
                  <td className="pair-cell">
                    <div className="pair-name">{op.pair.replace('/', '')}</div>
                    <div className="pair-direction">{op.direction}</div>
                  </td>
                  <td className="price-cell">
                    <div className="price-value">{op.spotPrice.toFixed(8)}</div>
                  </td>
                  <td className="price-cell">
                    <div className="price-value">{op.futuresPrice.toFixed(8)}</div>
                  </td>
                  <td className={`profit-cell ${op.buyProfit > 0 ? 'profit-positive' : 'profit-negative'}`}>
                    {op.buyProfit > 0 ? `+${op.buyProfit.toFixed(4)}%` : `${op.buyProfit.toFixed(4)}%`}
                  </td>
                  <td className={`profit-cell ${op.sellProfit > 0 ? 'profit-positive' : 'profit-negative'}`}>
                    {op.sellProfit > 0 ? `+${op.sellProfit.toFixed(4)}%` : `${op.sellProfit.toFixed(4)}%`}
                  </td>
                  <td className="volume-cell">
                    {formatVolume(op.volume)}
                  </td>
                  <td className="time-cell">
                    {formatTimeAgo(op.timestamp)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="app-footer">
        <p>
          Taxas consideradas: Spot {(config.spotMakerFee || 0) * 100}% | Futuros {(config.futuresMakerFee || 0.0002) * 100}% | 
          Lucro mínimo: {config.minProfitPercentage || 0.1}%
        </p>
      </footer>
    </div>
  );
}

export default App;
