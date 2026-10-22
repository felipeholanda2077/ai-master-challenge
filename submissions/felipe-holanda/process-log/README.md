# Process log

Como a solução foi construída: ferramentas, sequência, o que deu errado e as decisões que mudaram o resultado.
Tudo aqui é reproduzível: cada número citado sai de um script desta pasta ou de `solution/`.

## Ferramentas

| Ferramenta | Para quê |
|---|---|
| **Claude Code** (agente de código) | Exploração dos dados, testes estatísticos, backtests, código do scorer, interface, testes automatizados e documentação. Rodou o Python de verdade em vez de "imaginar" resultados. |
| pandas / scipy / scikit-learn | Análise e os modelos de comparação (o gradient boosting usado como "o que um baseline faria") |
| Playwright + Chromium headless | Abrir a interface, tirar os screenshots desta pasta e checar erros de console e scroll horizontal em desktop e mobile |
| pytest | Travar as regras que não podem quebrar (sem vazamento de futuro, correção de censura, filas, explicações, backtest > baseline) |


## Arquivos

```
analysis/
  01_first_look.py (+ .out.txt)     estrutura, nulos, chaves quebradas
  02_signal_tests.py (+ .out.txt)   quais features separam Won de Lost (χ², curva de sobrevivência, interação, carga)
  03_backtest.py (+ .out.txt)       "vai fechar?": AUC de 5 modelos em 6 snapshots
  04_score_design.py (+ .out.txt)   qual ordenação coloca mais receita do mês no topo
  05_backtest_producao.out.txt      o código de produção validado em 9 segundas-feiras
screenshots/                        a ferramenta rodando (desktop claro, mobile escuro) + script de captura
```

## Workflow

### 1. Entender o pedido antes de abrir os dados
Escolha do challenge 003 porque o deliverable é software funcionando. Do brief, três restrições guiaram tudo:
"o vendedor abre na segunda-feira", "precisa entender por que" e "não é só ordenar por valor".
A Kaggle estava bloqueada no ambiente; os mesmos CSVs (CC0) foram baixados da fonte original da Maven Analytics.

### 2. Primeira olhada (`01_first_look`)
Antes de qualquer score, os problemas que quebrariam um script ingênuo:
- `GTXPro` no pipeline vs `GTX Pro` no catálogo: 1.480 deals perderiam o preço num join.
- `technolgy` (typo) nos setores.
- **68% dos deals abertos sem conta**: qualquer feature de conta fica inutilizável justamente onde importa.
- 5 vendedores sem nenhum deal; Prospecting sem nenhuma data.

### 3. Testar o sinal antes de dar peso (`02_signal_tests`)
A abordagem padrão seria dar pontos por win rate de vendedor, produto, setor, porte. Testei antes: **nenhuma dessas variáveis
é estatisticamente diferente do acaso** (p de 0,26 a 0,97). Vendedor x produto: desvio observado 0,080, esperado por ruído 0,077.
Win rate histórico da conta (calculado sem vazamento): correlação −0,04.

Mas apareceram três coisas fortes:
- duração do ciclo: perdidos morrem cedo (mediana 14 dias), ganhos têm uma segunda onda em 60 a 120 dias;
- **o maior ciclo da história é 138 dias**, e 1.291 dos 1.589 deals em Engaging são mais velhos que isso;
- fim de trimestre: 80% de win rate em mar/jun/set/dez vs ~50% nos outros meses. **Descartado**: não é acionável para um deal
  aberto e, junto com "nenhum deal fecha no trimestre em que começou", tem cara de artefato do gerador sintético.

### 4. Backtest de "vai fechar?" (`03_backtest`)
Simulei segundas-feiras passadas (só dados conhecidos na data) e medi AUC. Resultado: tudo entre 0,48 e 0,52.
O gradient boosting com todas as features ficou em 0,49. **Esse é o ponto de virada**: um score de probabilidade de ganho
seria ruído com explicação bonita. Reformulei a pergunta para "o que fecha ganho nos próximos 30 dias e vale a pena?".
Para essa pergunta, a idade do deal dá AUC de 0,60 a 0,80.

### 5. Desenho do score (`04_score_design`)
Comparei 6 ordenações pelo que importa para o vendedor: receita do mês capturada no top 10 dele. Valor x ripeness ganhou,
seguido de perto por 60 pts de valor (log) + 40 pts de momento. Escolhi o aditivo: perde ~1 p.p. de receita, ganha em
acerto e dá para explicar em pontos.

### 6. Produto
- `lead_scorer/` em Python com a mesma função usada no backtest e na interface (o que foi validado é o que roda).
- Interface em HTML/JS puro: abre com duplo clique, sem servidor, sem build. O público é vendedor, não dev.
- Filas em vez de lista única: deal sem precedente não compete com deal vivo pela atenção da semana.
- Cada deal tem fase + ação + frases de "por quê" com o número e o tamanho da amostra por trás.
- Aba Time para o manager, plano da semana em texto para Slack, filtros por região/manager/vendedor.

### 7. Verificação
- 9 testes automatizados (`solution/tests`).
- Backtest do código de produção em 9 datas (`05_backtest_producao.out.txt`).
- Screenshots via Playwright, conferindo zero erros de console e zero scroll horizontal em 390px.

## Onde a IA errou e como foi corrigido

1. **Curva otimista por viés de censura (o erro mais importante).** A primeira versão estimava "chance de fechar no mês"
   só com deals já fechados. Isso ignora os deals que empacam e continuam abertos. Resultado: dizia que deals com 127 dias
   tinham 78% de chance de fechar ganhos no mês, e o painel mandava o vendedor gastar a semana neles. Com a correção
   (deals abertos contam como "em risco", à la Kaplan-Meier), o número vira 5% e a curva passa a ter pico em 85 dias.
   O backtest melhorou de 44,5% para 46,7% de receita capturada, e a taxa de acerto de 20% para 23%.
2. **Número otimista no backtest exploratório.** O `04_score_design` mostrava 69% de receita capturada. Ele só olhava deals
   cujo desfecho era conhecido, o que tira da lista justamente os deals que nunca fecham. O backtest do código de produção,
   com todos os deals abertos na data, dá 47%. O número publicado é o honesto.
3. **Uma correção apressada da censura** (usada para testar a ideia) colocava no denominador deals abertos cujo desfecho na janela
   ainda era desconhecido, e reportou 48,1%. A versão final só conta um deal aberto como "não fechou" quando a janela inteira já passou: 46,7%.
4. **Limiar de fase fixo** (`ripeness >= 0,45`) parou de funcionar quando a curva foi corrigida (pico caiu para 0,31): a fase
   "Janela de fechamento" sumiu. Virou relativo ao pico da curva (75%), e a fase "Meio do ciclo" foi separada em "Aquecendo" e "Esfriando",
   que pedem ações opostas.
5. Detalhes de código: `groupby(...).apply(include_groups=...)` só existe no pandas ≥ 2.2 (reescrito com agregação simples);
   `NaT` quebrava a serialização JSON; o texto da aba de método dizia que o modelo ML "acertou menos que o chute" quando a AUC
   era 0,49, o que é igual ao chute, não pior (corrigido).
6. **Data quality que o join escondia**: sem corrigir `GTXPro`, 17% dos deals ficariam sem preço silenciosamente.
   O loader agora falha alto se algum produto não tiver preço.

## Decisões que fazem a diferença em relação ao baseline

- **Testar antes de pontuar.** O baseline previsível é um score com pesos para vendedor, setor, porte e produto. Aqui está a evidência
  de que esses pesos seriam ruído (p-valores e AUC), e por isso eles não entram.
- **Trocar a pergunta.** De "vai fechar?" (sem sinal) para "o que fecha no próximo mês e quanto vale?" (com sinal e acionável na segunda-feira).
- **Validar o código que roda, não o notebook.** O backtest chama a mesma função que gera a interface.
- **Achar o problema que ninguém pediu.** 64% do valor em aberto está em deals sem precedente histórico, e a região Central não tem
  pipeline para o próximo mês. Ninguém perguntou isso, mas o forecast da Head de RevOps depende disso.
- **Dizer o que não funciona.** A aba "Como o score funciona" mostra para o vendedor o backtest e o que o score não faz.
