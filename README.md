
## Visão Geral

Este projeto implementa uma **DEX (Decentralized Exchange) baseada em CPMM (Constant Product Market Maker)** com uma competição entre bots. Cada bot representa um participante que negocia automaticamente na exchange. O desempenho é medido através do **PnL (Profit and Loss)** ao longo da competição.

A aplicação inclui:

* Smart contracts em Solidity (DEX + tokens)
* Backend Node.js para leitura da blockchain
* Bots (teste) em Python que executam estratégias
* Frontend simples em HTML/CSS/JS para visualização

#### Estrutura:

```
dex_cpmm/
│
├── contracts/           # Smart contracts (DEX e tokens)
├── scripts/             # Scripts de deploy, setup e start
├── backend/             # Backend Node.js
├── bots/                # Bots em Python
│   ├── common/          # Bots base e lógica comum
│   ├── causes/          # Bots que geram mercado
│   └── *.py             # Bots estratégicos
│
├── frontend/            # UI (HTML, CSS, JS)
│
├── traders.json         # Lista de bots (nome + address)
├── .env                 # Configuração (endereços)
├── package.json
```

---

#### Objetivo

Simular um ambiente de mercado onde:

* Todos os bots começam com o mesmo saldo
* Interagem com uma DEX 
* Competem entre si
* O ranking é determinado pelo PnL

---

## Componentes do Sistema

### 1. Smart Contracts

Responsáveis por:

* Gerir pools de liquidez
* Executar swaps (comprar ou vender na dex)
* Controlar competição
* Armazenar estado do mercado

Principais funções:

* `createPool`: cria um mercado (pool) de trading entre dois tokens
* `buy`: troca token base por token do produto (compra o ativo)
* `sell`: troca token do produto por token base (vende o ativo)
* `getSpotPrice`: retorna o preço atual do ativo no pool
* `getCompetitionStatus`: indica o estado da competição (não começou, ativa ou terminou)


### 2. Backend

Responsável por:

* Ler estado da blockchain
* Calcular ranking
* Expor API REST

Endpoints principais:

* `/state`
* `/ranking`
* `/trades`
* `/products`


### 3. Bots

Executam estratégias de trading automaticamente.

Tipos:

#### Bots de mercado (causes)

* NoiseBot: faz trades aleatórios, sem lógica clara, só gera “ruído” no mercado
* ShockBot: faz movimentos bruscos de compra/venda para criar volatilidade e mudanças de preço rápidas
* TrendBot: segue a direção do preço, compra quando sobe e vende quando cai (segue tendência)

#### Bots estratégicos

* ConservativeBot: evita risco, faz poucas operações e tende a proteger saldo em vez de buscar lucro agressivo
* MomentumBot: aposta que o movimento atual vai continuar, entra forte na direção do preço
* MeanReversionBot: aposta que o preço volta à média, compra quando cai demais e vende quando sobe demais


### 4. Frontend

Mostra:

* Estado da competição
* Produtos e pools
* Trades em tempo real
* Ranking dos bots

---

## Lógica do CPMM

A DEX utiliza o modelo **Constant Product Market Maker (CPMM)** para cada pool de liquidez.

Cada mercado (pool) segue a fórmula:

```
x * y = k
```

Onde:

* x = reserva de token base (ex: CASH / token base da exchange)
* y = reserva do token de produto (ativo negociado)
* k = constante do pool (mantida automaticamente pelos swaps)

---

### Preço implícito

O preço do ativo em cada pool é dado por:

```
price = x / y
```

---

### Arquitetura do sistema

Este projeto não possui um único mercado.

Em vez disso:

* Existe um token base comum para toda a exchange
* Existem múltiplos tokens de produto
* Cada productToken possui um pool independente
* Cada pool mantém as suas próprias reservas (x, y) e constante k

---

### Implicação importante

* Cada ativo tem o seu próprio mercado CPMM
* Swaps em um pool não afetam os outros pools
* O preço e liquidez evoluem de forma independente por produto


---

## Lógica da Competição

Estados:

* NOT_STARTED
* ACTIVE
* ENDED

Fluxo:

1. Setup do mercado
2. Start da competição
3. Bots operam
4. Ranking é atualizado
5. Competição termina

---

## Ranking (PnL)

Para cada bot:

```
Total Value = CASH + (tokens * preço)
PnL = Total Value - saldo inicial
```

---

## Como Rodar o Projeto

### 1. Subir blockchain local

```bash
yarn hhnode
```


### 2. Deploy dos contratos

```bash
yarn deploy:local
```

### 3. Setup do mercado

```bash
yarn setup:local
```

Isso vai:

* criar pools
* distribuir saldo
* registar traders


### 4. Iniciar backend

```bash
yarn backend
```


### 5. Iniciar competição

```bash
yarn start:local 
```


### 6. Iniciar bots

```bash
python bots/run_all_bots.py
```


### Ordem alternativa válida

```bash
hhnode → deploy → setup → backend → bots → start
```

---

## Boas Práticas

* Sempre rodar `setup:local` após deploy
* Não misturar estados de deploy antigos
* Reiniciar `hhnode` para ambiente limpo
* Garantir `.env` atualizado



