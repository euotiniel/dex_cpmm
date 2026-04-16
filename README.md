Segue a documentação completa, organizada em dois ficheiros como pediste.

---

# README.md

## Visão Geral

Este projeto implementa uma **DEX (Decentralized Exchange) baseada em CPMM (Constant Product Market Maker)** com uma competição entre bots.

Cada bot representa um participante que negocia automaticamente na exchange. O desempenho é medido através do **PnL (Profit and Loss)** ao longo da competição.

A aplicação inclui:

* Smart contracts em Solidity (DEX + tokens)
* Backend Node.js para leitura da blockchain
* Bots em Python que executam estratégias
* Frontend simples em HTML/CSS/JS para visualização

---

## Objetivo

Simular um ambiente de mercado onde:

* Todos os bots começam com o mesmo saldo
* Interagem com uma DEX baseada em liquidez
* Competem entre si
* O ranking é determinado pelo PnL

---

## Estrutura do Projeto

```
dex_cpmm/
│
├── contracts/           # Smart contracts (DEX e tokens)
├── scripts/             # Scripts de deploy, setup e start
├── backend/             # Backend Node.js
├── bots/                # Bots em Python
│   ├── common/          # Cliente base e lógica comum
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

## Componentes do Sistema

### 1. Smart Contracts

Responsáveis por:

* Gerir pools de liquidez
* Executar swaps
* Controlar competição
* Armazenar estado do mercado

Principais funções:

* `createPool`
* `buy`
* `sell`
* `getSpotPrice`
* `getCompetitionStatus`

---

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

---

### 3. Bots

Executam estratégias de trading automaticamente.

Tipos:

#### Bots de mercado (causes)

* NoiseBot
* ShockBot
* TrendBot

#### Bots estratégicos

* ConservativeBot
* MomentumBot
* MeanReversionBot

---

### 4. Frontend

Mostra:

* Estado da competição
* Produtos e pools
* Trades em tempo real
* Ranking dos bots

---

## Lógica do CPMM

A DEX usa a fórmula:

```
x * y = k
```

Onde:

* x = reserva de CASH
* y = reserva do produto

Preço implícito:

```
price = x / y
```

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

---

### 2. Deploy dos contratos

```bash
yarn deploy:local
```

---

### 3. Setup do mercado

```bash
yarn setup:local
```

Isso vai:

* criar pools
* distribuir saldo
* registar traders

---

### 4. Iniciar backend

```bash
yarn backend
```

---


### 5. Iniciar competição

```bash
yarn start:local 
```

---

### 6. Iniciar bots

```bash
python bots/run_all_bots.py
```

---

### Ordem alternativa válida

```bash
hhnode → deploy → setup → backend → bots → start
```

---

## Problemas Comuns

### 1. Nenhum produto aparece

Causa:

* `setup:local` não foi executado

---

### 2. Saldo = 0 / PnL = -1000

Causa:

* bots não receberam CASH

---

### 3. Pool does not exist

Causa:

* `.env` desatualizado
* ou pools não criadas

---

### 4. Só um bot funciona

Causa:

* traders.json inconsistente
* ou bots com config errada

---

## Boas Práticas

* Sempre rodar `setup:local` após deploy
* Não misturar estados de deploy antigos
* Reiniciar `hhnode` para ambiente limpo
* Garantir `.env` atualizado

---

## Extensões Futuras

* UI mais avançada
* Estratégias de bots com IA
* Persistência de dados
* Deploy em rede real

---

# DOCUMENTACAO.md

## Arquitetura Geral

O sistema segue uma arquitetura distribuída:

* Blockchain → fonte de verdade
* Backend → agregador de dados
* Bots → agentes ativos
* Frontend → visualização

---

## Separação de Responsabilidades

### Smart Contracts

* lógica financeira
* segurança
* execução de trades

---

### Backend

* leitura da blockchain
* normalização de dados
* cálculo de métricas

---

### Bots

* decisão de trading
* execução de estratégias

---

### Frontend

* visualização
* experiência do utilizador

---

## Decisões Técnicas

### CPMM

Escolhido por:

* simplicidade
* previsibilidade
* uso real em DeFi

---

### Hardhat

* ambiente local rápido
* contas pré-geradas
* fácil deploy

---

### Node.js Backend

* integração com ethers.js
* simples e eficiente

---

### Bots em Python

* flexibilidade
* fácil implementação de estratégias

---

## Fluxo de Dados

1. Bots executam trades
2. Smart contract processa
3. Eventos são emitidos
4. Backend escuta eventos
5. Estado é atualizado
6. Frontend consome API

---

## Estratégias dos Bots

### NoiseBot

* aleatório

### ShockBot

* alta volatilidade

### TrendBot

* cria tendência

### MomentumBot

* segue tendência

### MeanReversionBot

* aposta na média

### ConservativeBot

* baixo risco

---

## Segurança

* uso de rede local (Hardhat)
* contas públicas (apenas para teste)
* sem persistência externa

---

## Limitações

* não persistente
* dependente de ordem de execução
* sem UI interativa de trading

---

## Considerações para Avaliação

* todos começam com mesmo saldo
* mercado é justo
* ranking baseado em desempenho real
* estratégias impactam resultado

---

## Possíveis Melhorias

* adicionar taxas
* melhorar UI
* usar dados históricos
* bots com ML
* deploy em testnet


