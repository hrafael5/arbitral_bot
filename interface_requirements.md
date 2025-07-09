# Requisitos da Interface Web para Arbitragem MEXC Spot vs Futuros

## Funcionalidades Principais
- Manter todas as funcionalidades atuais do bot (identificação de oportunidades via REST para Spot e WebSocket para Futuros)
- Apresentar as oportunidades de arbitragem em formato de tabela semelhante à imagem de referência
- Atualizar as taxas para valores mais precisos da MEXC:
  - Spot: 0% para maker (ordens limite)
  - Futuros: 0.02% para maker (ordens limite)

## Elementos Prioritários da Interface
1. **Lucro na Compra** - Diferencial percentual quando compra Spot e vende Futuros
2. **Lucro na Venda** - Diferencial percentual quando vende Spot e compra Futuros
3. **Volume** - Volume de negociação disponível para a oportunidade
4. **Tempo** - Tempo desde que a oportunidade foi identificada

## Abordagem Técnica
- Solução integrada (bot + interface web) para maior simplicidade
- Backend: Adaptar o bot atual para servir como API e servidor web
- Frontend: Interface web simples e responsiva para exibir as oportunidades

## Referência Visual
A interface deve seguir o estilo da imagem de referência fornecida pelo utilizador, com foco em:
- Tabela organizada com linhas para cada par/oportunidade
- Colunas coloridas para indicar lucro (verde para positivo, vermelho para negativo)
- Informações claras e atualizadas em tempo real
