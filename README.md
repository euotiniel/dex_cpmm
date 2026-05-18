# DEX CPMM

<p align="">
Exchange descentralizada baseada em CPMM, com bots autónomos, ranking dinâmico, pesos de tokens variáveis e competição em tempo real.
</p>

O sistema combina:

- smart contracts em Solidity
- backend event-driven
- bots autónomos
- ranking em tempo real
- pesos dinâmicos
- observabilidade do mercado
- exportação académica
- integração de bots externos

A DEX CPMM é um ambiente competitivo de simulação de mercado construído sobre um modelo de Automated Market Maker (AMM).

---

# Índice

- [1. Instalação](#1-instalação)
- [2. Execução](#2-execução)
- [3. Visão Geral](#3-visão-geral)
- [4. Arquitetura do Sistema](#5-arquitetura-do-sistema)
- [5. Como a DEX Funciona](#6-como-a-dex-funciona)
- [6 Sistema de Avaliação](#7-sistema-de-avaliação)
- [7. Bots](#9-bots)
- [8. Tecnologias](#14-tecnologias)

---

## 1. Instalação

### Requisitos

- Node.js 20+
- Python 3.10+
- Yarn

---

### Dependências

```bash
yarn install
pip install -r requirements.txt
```

---

## 2. Execução

### 1. Blockchain local

```bash
yarn bootstrap:local
```

---

### 2. Configurar mercado

```bash
yarn setup:local
```

---

### 3. Backend

```bash
yarn backend
```

Dashboard:

```txt
http://localhost:3001
```

---

### 4. Iniciar competição

```bash
yarn start:5m
```

Outras durações:

```bash
yarn start:10m
yarn start:30m
```

---

### 5. Iniciar bots

```bash
python bots/run_all_bots.py
```

---

### Fluxo Completo

```txt
Hardhat Node
    ↓
Deploy dos contratos
    ↓
Criação das pools
    ↓
Distribuição inicial
    ↓
Inicialização backend
    ↓
Lançamento dos bots
    ↓
Competição
```

---

### Considerações

Este projeto foi desenvolvido como um ambiente experimental para:

- estudo de mercados automatizados
- análise de competição algorítmica
- experimentação com AMMs
- sistemas multi-agente
- infraestrutura blockchain
- simulação de comportamento de mercado

Não é destinado a uso financeiro em produção, pelo menos por agora.

---

## 3. Visão Geral

A DEX CPMM implementa um sistema completo de exchange descentralizada baseada em Constant Product Market Maker.

O objetivo é criar um ambiente competitivo entre bots autónomos que operam sobre pools de liquidez em tempo real.

O sistema inclui:

- contratos inteligentes
- backend em tempo real
- ranking dinâmico
- análise de performance
- fairness engine
- exportação de métricas
- observabilidade do mercado

---

## 4. Arquitetura do Sistema

```txt
Bots
   ↓
Backend Event-Driven
   ↓
Smart Contracts
   ↓
Pools CPMM
```

### Componentes

#### Smart Contracts

- gestão de pools
- swaps
- liquidez
- fees

#### Backend

- processamento de eventos
- ranking
- métricas
- observabilidade

#### Bots

- estratégias autónomas
- simulação de mercado
- arbitragem
- stress testing

```txt
dex_cpmm/
├── contracts/
├── backend/
├── bots/
├── scripts/
├── analytics/
├── exports/
└── dashboard/
```

---

## 5. Como a DEX Funciona

### 5.1 CPMM

O sistema utiliza o modelo:

```txt
x * y = k
```

Exemplo:

```txt
100 * 100 = 10.000
```

Após um swap:

```txt
110 * 90.90 ≈ 10.000
```

---

### 5.2 Pools

Cada pool contém dois ativos.

Os preços são ajustados automaticamente pela relação entre reservas.

---

### 5.3 Swaps

Os utilizadores trocam tokens diretamente contra a pool.

Não existe order book.

---

### 5.4 Slippage

O slippage aumenta conforme:

- tamanho da ordem
- liquidez disponível
- impacto no pool

---

### 5.5 Fees

Cada swap aplica uma taxa.

As fees:

- remuneram liquidez
- estabilizam o sistema
- reduzem spam de operações

---

## 6. Sistema de Avaliação

### 6.1 Pesos Dinâmicos

Os ativos possuem pesos variáveis.

O ranking adapta-se conforme:

- volatilidade
- liquidez
- comportamento do mercado

---

### 6.2 Portfolio Ponderado

O score final considera:

- valor do portfolio
- risco
- eficiência
- drawdown
- consistência

---

### 6.3 PnL

O sistema calcula:

- lucro
- prejuízo
- retorno acumulado
- performance relativa

---

### 6.4 Nota

Cada bot recebe uma nota dinâmica em tempo real.

---

## 7. Bots

O sistema possui múltiplos agentes autónomos.

| Bot | Estratégia |
|---|---|
| Noise Bot | Operações aleatórias |
| Trend Bot | Segue tendência |
| Shock Bot | Gera volatilidade |
| Mean Reversion Bot | Reversão estatística |

---

## 8. Tecnologias

| Camada | Stack |
|---|---|
| Smart Contracts | Solidity |
| Blockchain | Hardhat |
| Backend | Node.js |
| Bots | Python |
| Dashboard | React |
| Comunicação | WebSockets |

---
