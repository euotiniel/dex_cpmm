# DEX CPMM — Bot Battle

Simulação de uma DEX (Decentralized Exchange) baseada em CPMM onde bots competem entre si em tempo real.

O sistema foi desenvolvido para simular um mercado competitivo próximo de um ambiente real, incluindo:

- pools CPMM
- slippage
- fees
- volatilidade
- bots com estratégias diferentes
- PnL variável
- competição em tempo real
- ranking dinâmico
- pesos variáveis (dos tokens) definidos durante a competição

---

# Objetivo do Projeto

O objetivo principal da competição é que cada estudante desenvolva um bot capaz de operar na DEX e obter o melhor desempenho possível.

A avaliação não é fixa. Durante a competição, o professor pode alterar o peso de cada token em tempo real, fazendo com que determinados ativos passem a valer mais ou menos na nota final.

Exemplo:

| Token | Peso |
|---|---|
| TKN1 | 80% |
| TKN2 | 15% |
| TKN3 | 5% |
| TKN4 | 0% |
| TKN5 | 0% |

Neste cenário:

- possuir TKN1 torna-se extremamente importante
- TKN4 e TKN5 praticamente deixam de impactar a nota
- bots precisam adaptar comportamento ao mercado e aos pesos atuais

---

# Como a DEX funciona

O projeto utiliza o modelo:

## CPMM (Constant Product Market Maker)

A fórmula principal é:

```txt
x * y = k
```

Onde:

- x = reserva do token A
- y = reserva do token B
- k = constante da pool

---

## Exemplo simples

Pool:

```txt
100 TKN1
100 TKN2
```

Logo:

```txt
100 * 100 = 10000
```

Se um bot compra TKN2 usando TKN1:

```txt
110 TKN1
90.90 TKN2
```

A constante permanece aproximadamente igual:

```txt
110 * 90.90 ≈ 10000
```

---

# Como o preço é calculado

O preço é implícito pela relação entre as reservas.

Exemplo:

```txt
Preço TKN2 em relação ao TKN1:

price = reserveTKN1 / reserveTKN2
```

Se a reserva de TKN2 diminuir:

- TKN2 fica mais escasso
- preço sobe

Se a reserva aumentar:

- preço cai

---

### O que é um Swap

Swap significa troca de um token por outro.

Exemplo:

```txt
Bot entrega:
73 TKN3

Bot recebe:
70 TKN4
```

O sistema NÃO trabalha com troca 1:1.

O valor recebido depende de:

- reservas atuais da pool
- slippage
- fee
- impacto da operação

---

### Slippage

Slippage é a diferença entre o preço esperado e o preço real executado.

Quanto maior a operação:

- maior impacto na pool
- pior preço
- maior slippage

---

### Fee

Cada operação possui taxa.

Exemplo atual:

```txt
0.3%
```

Isso cria fricção real no mercado.

Bots agressivos podem perder dinheiro apenas operando excessivamente.

---

### Porque todos os bots podem perder dinheiro

Num mercado CPMM:

- bots negociam contra a pool
- não apenas entre si

Então é possível:

- todos perderem
- alguns perderem mais
- poucos conseguirem lucro

Isso acontece por:

- fees
- slippage
- operações ruins
- timing ruim
- volatilidade

---

# Estratégias dos Bots

O sistema possui múltiplos comportamentos.

## Noise Bot

Executa operações aleatórias para gerar movimento no mercado.

## Trend Bot

Segue tendência.

Compra ativos em subida e vende em queda.

## Shock Bot

Gera movimentos bruscos.

Pode causar pânico ou pumps artificiais.

## Mean Reversion Bot

Assume que preços extremos voltarão ao normal.

---

# Sistema de Avaliação

## Pesos Dinâmicos

Exemplo:

```txt
TKN1 = 20%
TKN2 = 20%
TKN3 = 20%
TKN4 = 20%
TKN5 = 20%
```

Depois:

```txt
TKN1 = 80%
TKN2 = 15%
TKN3 = 5%
```

Isso muda imediatamente:

- ranking
- score
- nota
- importância dos ativos

---

# Como o Score é calculado

Cada token do bot possui um valor ponderado.

Exemplo:

```txt
Bot:
100 TKN1
50 TKN2

Pesos:
TKN1 = 80%
TKN2 = 20%
```

O sistema calcula:

```txt
score =
(valor TKN1 * 0.8)
+
(valor TKN2 * 0.2)
```

---

# Como o PnL é calculado

PnL significa:

```txt
Profit and Loss
```

O sistema calcula:

```txt
PnL =
valor atual da carteira
-
valor inicial
```

Se positivo:

```txt
lucro
```

Se negativo:

```txt
prejuízo
```

---

# Como a Nota é calculada

A nota deriva diretamente do PnL ponderado.

Fórmula atual:

```txt
nota = 10 + (pnlPct * 2)
```

Limitada entre:

```txt
0 e 20
```

Exemplos:

| PnL | Nota |
|---|---|
| +5% | 20 |
| +3% | 16 |
| +1% | 12 |
| 0% | 10 |
| -1% | 8 |
| -3% | 4 |
| -5% | 0 |

---

# Interface do Professor (Para simular mudanças bruscas)

O projeto possui uma UI exclusiva para o professor.

Nela é possível:

- visualizar pesos atuais
- alterar pesos em tempo real
- igualar pesos automaticamente
- bloquear alterações após o fim da competição

---

# Interface Principal

A UI principal apresenta:

- ranking em tempo real
- notas
- PnL
- swaps realizados
- histórico de trades
- gráficos
- preços
- pools
- dominância de tokens
- tempo restante da competição

---

# Arquitetura do Sistema

```txt
Bots Python
      ↓
Smart Contract Solidity
      ↓
Eventos On-Chain
      ↓
Backend Node.js
      ↓
SSE / API
      ↓
Frontend
```

---

# Tecnologias

| Camada | Stack |
|---|---|
| Smart Contracts | Solidity, Hardhat, OpenZeppelin |
| Backend | Node.js, Express, SSE, Ethers.js |
| Bots | Python, web3.py |
| Frontend | HTML, CSS, Vanilla JS |
| Blockchain | Hardhat Local Network |

---

# Execução

## Instalar dependências

```bash
yarn install
pip install -r requirements.txt
```

---

## Iniciar sistema completo

```bash
yarn bootstrap:local
```

---

## Backend

```bash
yarn backend
```

# Iniciar combate
```bash
yarn start:5m    # 5 minutos
yarn start:10m   # 10 minutos
yarn start:30m   # 30 minutos
```
```


---

## Bots

```bash
python bots/run_all_bots.py
```

---

# Observações

- o mercado não é determinístico
- resultados variam entre execuções
- bots podem ganhar ou perder dinheiro
- pesos alteram completamente a dinâmica da competição
- slippage e fees impactam fortemente operações grandes

---

# Conclusão

O projeto evoluiu de uma simples demo CPMM para um ambiente competitivo completo, com:

- mercado em tempo real
- competição entre bots
- avaliação dinâmica
- métricas de desempenho
- simulação de comportamento de mercado
- ranking ponderado
- sistema de notas
- observabilidade completa