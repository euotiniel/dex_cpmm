
## DEX CPMM — Bot Battle

Simulação de uma **DEX (Decentralized Exchange) baseada em CPMM** onde bots competem entre si em tempo real. O dashboard apresenta preços ao vivo, gráficos por token, rankings de PnL e um feed de trades estilo Binance.

---

## Tecnologias

| Camada | Stack |
|---|---|
| Smart Contracts | Solidity 0.8.24, OpenZeppelin 5, Hardhat |
| Backend | Node.js 20+, Express, Ethers.js v6, SSE |
| Bots | Python 3.10+, web3.py |
| Frontend | HTML/CSS/JS vanilla, Chart.js 4 |

---

## Estrutura do Projeto

```
stockX/
├── contracts/
│   ├── CPMMExchange.sol     # DEX principal (CPMM + competição)
│   └── MarketToken.sol      # Token ERC-20 genérico (CASH + PRODs)
│
├── scripts/
│   ├── deploy.js            # Deploy de todos os contratos
│   ├── setup.js             # Criação de pools e registo de traders
│   ├── start.js             # Início da competição (lê DURATION do .env)
│   └── bootstrap.js         # Setup completo automático (recomendado)
│
├── backend/
│   ├── server.js            # API REST + SSE + ficheiros estáticos
│   ├── blockchain.js        # Listener de eventos + atualização de estado
│   ├── state.js             # Estado global em memória + histórico de preços
│   └── ranking.js           # Cálculo de PnL e ranking
│
├── bots/
│   ├── config.json          # Parâmetros de todos os bots (editável)
│   ├── common/
│   │   ├── config.py        # Carrega config.json (caminho único)
│   │   ├── botBase.py       # Classe base + loop principal
│   │   └── dexClient.py     # Cliente Web3 com slippage e retry
│   ├── causes/              # Bots que geram movimento no mercado
│   │   ├── noiseBot.py
│   │   ├── shockBot.py
│   │   └── trendBot.py
│   ├── conservativeBot.py
│   ├── momentumBot.py
│   ├── meanReversionBot.py
│   └── run_all_bots.py      # Lança todos os bots em paralelo
│
├── frontend/
│   ├── index.html           # Dashboard stock-market style
│   ├── app.js               # SSE + Chart.js + componentes
│   └── style.css            # Dark terminal theme
│
├── test/
│   └── CPMMExchange.test.js # Testes Hardhat + Chai (28 testes)
│
├── requirements.txt         # Dependências Python
├── .env.example
├── traders.json
├── hardhat.config.js
└── package.json
```

---

## Pré-requisitos

Antes de começar, garante que tens instalado:

- [Node.js 20+](https://nodejs.org/)
- [Yarn](https://yarnpkg.com/) — `npm install -g yarn`
- [Python 3.10+](https://www.python.org/)

---

## Instalação (só na primeira vez)

#### 1. Clonar e entrar na pasta do projeto

```bash
git clone https://github.com/euotiniel/dex_cpmm/

```
Entre no diretório 

```bash
cd dex_cpmm
```

#### 2. Instalar dependências JavaScript

```bash
yarn install
```

#### 3. Instalar dependências Python

```bash
pip install -r requirements.txt
```

---

## Como Executar o Projeto

Vais precisar de **5 terminais** abertos na pasta raiz do projeto.

---

### Terminal 1 — Blockchain local

```bash
yarn bootstrap:local
```

Este comando:
- Levanta um nó Hardhat local (blockchain de teste)
- Faz deploy de todos os contratos
- Gera o ficheiro `.env` com os endereços
- Gera o `traders.json` com os bots

> **Deixa este terminal aberto** durante toda a sessão.

---

### Terminal 2 — Setup do mercado

```bash
yarn setup:local
```

Este comando (corre apenas uma vez após o bootstrap):
- Cria os 5 pools de liquidez (PROD1 a PROD5)
- Regista os 6 bots como traders
- Distribui 1000 CASH a cada bot

---

### Terminal 3 — Backend + Dashboard

```bash
yarn backend
```

- Inicia o servidor na porta 3001
- Abre o browser em **http://localhost:3001** para ver o dashboard

> Se receberes `EADDRINUSE` (porta já em uso), mata o processo antigo:
> ```powershell
> # PowerShell
> Stop-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess -Force
> ```

---

### Terminal 4 — Iniciar a competição

Escolhe a duração que queres:

```bash
yarn start:5m    # 5 minutos
yarn start:10m   # 10 minutos
yarn start:30m   # 30 minutos
```

Ou define `DURATION=<segundos>` no `.env` e usa:

```bash
yarn start:local
```

---

### Terminal 5 — Lançar os bots

```bash
python bots/run_all_bots.py
```

Os 6 bots arrancam em paralelo e começam a negociar assim que a competição estiver ativa. Para os parar: `Ctrl+C`.

---

### Ordem resumida

```
Terminal 1: yarn bootstrap:local     ← manter aberto
Terminal 2: yarn setup:local         ← pode fechar depois
Terminal 3: yarn backend             ← manter aberto
Terminal 4: yarn start:5m            ← pode fechar depois
Terminal 5: python bots/run_all_bots.py  ← manter aberto
```

**Dashboard em tempo real:** http://localhost:3001

---

## Para recomeçar do zero

```bash
# 1. Para tudo (Ctrl+C em todos os terminais)
# 2. Reinicia no Terminal 1:
yarn bootstrap:local

# 3. Repete os passos 2 a 5
```

---

## Dashboard

| Secção | Descrição |
|---|---|
| Status bar | Estado da competição + countdown |
| Top Gainers / Losers | Tokens com maior subida/queda desde o início |
| Market Overview | Tabela com preço, variação, reservas e volume |
| Price Charts | Gráficos de linha em tempo real por token (Chart.js) |
| Live Trades | Feed de trades ao vivo (estilo exchange) |
| Leaderboard | Ranking de bots por PnL |

Atualização em tempo real via **Server-Sent Events (SSE)** — sem polling.

---

## Bots

| Bot | Tipo | Estratégia |
|---|---|---|
| NoiseBot | Mercado | Trades aleatórios, pequenos |
| ShockBot | Mercado | Trades grandes e agressivos |
| TrendBot | Mercado | Segue a tendência de preço |
| ConservativeBot | Estratégico | Pouco risco, protege capital |
| MomentumBot | Estratégico | Aposta na continuação da tendência |
| MeanReversionBot | Estratégico | Aposta na reversão à média |

Para ajustar parâmetros (montantes, thresholds, intervalos), edita **`bots/config.json`** sem tocar no código.

---

## Testes

```bash
yarn compile   # compila os contratos
yarn test      # corre os 28 testes
```

Cobertura:
- Deployment e configuração
- Fórmula CPMM e cálculo de taxa
- Buy/sell com atualização correta de reservas
- Proteção de slippage
- Ciclo de vida da competição (start, time-travel, end)
- Gestão de traders

---

## Lógica CPMM

Cada pool segue a fórmula **x · y = k**:

```
x = reserva de CASH   y = reserva do token   k = constante
```

**Preço implícito:** `price = x / y`

**Taxa de fee:** 0.3%

**Cálculo do output:**
```
amountOut = (amountIn × 9970 × reserveOut) / (reserveIn × 10000 + amountIn × 9970)
```

---

## Segurança implementada

| Área | Melhoria |
|---|---|
| Contrato | `amountOutMin` em `buy()` e `sell()` — proteção contra slippage |
| Contrato | `endCompetition()` só pode ser chamado após `competitionEndTime` |
| Contrato | `addLiquidity()` valida reservas não-zero |
| Backend | Rate limiting: 60 req/min por IP |
| Backend | Sem sobreposição de chamadas de refresh (overlap lock) |
| Backend | Erro isolado por endpoint (sem crash total) |
| Bots | Slippage protection calculada antes de cada transação |
| Bots | Retry automático até 3 vezes em caso de falha |

---

## Ranking (PnL)

```
Total Value = saldo CASH + Σ(tokens_i × preço_i)
PnL = Total Value − saldo inicial (1000 CASH)
```

---

## Variáveis de Ambiente

O ficheiro `.env` é gerado automaticamente pelo `bootstrap:local`. Para referência, o `.env.example` contém:

```env
RPC_URL=http://127.0.0.1:8545
EXCHANGE_ADDRESS=
CASH_ADDRESS=
PROD1_ADDRESS=
PROD2_ADDRESS=
PROD3_ADDRESS=
PROD4_ADDRESS=
PROD5_ADDRESS=
INITIAL_BASE_BALANCE=1000
TRADERS_FILE=traders.json
PORT=3001
DURATION=300
BOT_NOISE_PK=
BOT_SHOCK_PK=
BOT_TREND_PK=
BOT_CONSERVATIVE_PK=
BOT_MOMENTUM_PK=
BOT_MEAN_REVERSION_PK=
```

> O `.env` contém chaves privadas de desenvolvimento. Nunca o commites para o git.
