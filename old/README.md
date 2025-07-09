# Bot de Arbitragem Spot vs. Futuros (MEXC & Gate.io)

Este bot monitora os mercados Spot e de Futuros Perpétuos das corretoras **MEXC** e **Gate.io** para identificar oportunidades de arbitragem. Ele utiliza WebSockets para receber dados de preço em tempo real e apresenta as oportunidades em um dashboard web interativo.


## 🚀 Funcionalidades

* **Monitoramento Multi-Corretora:** Conecta-se simultaneamente aos mercados da MEXC e da Gate.io via WebSockets.
* **Estratégia de Arbitragem Principal:** Calcula o spread para oportunidades de **Spot vs. Futuros**, incluindo:
    * **Intra-Exchange:** Comprar Spot e Vender Futuros na mesma corretora.
    * **Inter-Exchange:** Comprar Spot em uma corretora e Vender Futuros na outra.
* **Estratégia Opcional:** Inclui uma estratégia de **Futuros vs. Futuros** (Inter-Exchange) que pode ser ativada/desativada no `conf.ini`.
* **Cálculo de Taxas:** Subtrai automaticamente as taxas de maker para estimar o lucro líquido real de cada oportunidade.
* **Dashboard Web em Tempo Real:** Apresenta as oportunidades em uma interface web fácil de usar, com filtros e ordenação.
* **Log de Oportunidades:** Armazena um histórico de todas as oportunidades encontradas no arquivo `opportunities.log` para análise posterior.

## 🤝 Contribuições

Este é um projeto em desenvolvimento. Se você tiver ideias para melhorias ou encontrar bugs, sinta-se à vontade para abrir uma *Issue* ou enviar um *Pull Request*.

## ❤️ Agradecimentos e Doações

Se você achou este projeto útil e quer apoiar o desenvolvimento, pode me pagar um café através de qualquer uma destas carteiras:

* **BTC Rede BSC:** `0x6e14af9f05deeac3670e96d76649a86d50cbfe36`

## 🛠️ Setup

#### Pré-requisitos
* [Node.js](https://nodejs.org/) versão 16 ou superior.
* [NPM](https://www.npmjs.com/) (geralmente instalado junto com o Node.js).

#### Clonar e Instalar o Repositório

```bash
# Clone o repositório para a sua máquina local
git clone [https://github.com/SEU-USUARIO/NOME-DO-SEU-REPOSITORIO.git](https://github.com/SEU-USUARIO/NOME-DO-SEU-REPOSITORIO.git)

# Entre na pasta do projeto
cd NOME-DO-SEU-REPOSITORIO

# Instale todas as dependências necessárias
npm install
```

## ⚙️ Configuração

Todas as configurações principais do bot são gerenciadas no arquivo `conf.ini`.

* **[general]:** Configurações gerais como o nível de log e a porta do servidor web.
* **[arbitrage]:** Defina o percentual de lucro mínimo (`min_profit_percentage`) para uma oportunidade ser sinalizada e ative/desative a estratégia de Futuros vs. Futuros.
* **[mexc]:** Configure as URLs da API e as taxas da MEXC. Adicione tokens à `blacklist` para serem ignorados.
* **[gateio]:** Configure as URLs da API e as taxas da Gate.io. Adicione tokens à `blacklist` para serem ignorados.
* **[signaling]:** Defina como os sinais devem ser tratados.

## ▶️ Uso

Para iniciar o bot, execute o seguinte comando no seu terminal, dentro da pasta do projeto:

```bash
npm start
```

Isso iniciará o servidor e o processo de monitoramento. O terminal exibirá os logs em tempo real.

Para visualizar o painel de controle, abra seu navegador e acesse:

**http://localhost:3000** (ou a porta que você definiu no `conf.ini`).

O dashboard exibirá:
* Uma tabela com as **oportunidades de arbitragem** encontradas.
* Um **monitor de pares** que mostra os preços de Spot e Futuros sendo recebidos em tempo real.
* **Filtros** para ajudar a visualizar apenas as oportunidades que lhe interessam.
