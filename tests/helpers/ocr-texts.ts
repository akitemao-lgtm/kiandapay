/**
 * Texto tal como o OCR o devolveu em comprovativos verdadeiros, com os erros de
 * leitura incluídos (REFERENCIA sem acento, "K29 900,00" em vez de "Kz 9 900,00",
 * lixo do cabeçalho). É assim que a leitura tem de aguentar.
 */

/** Multicaixa Express, "pagamento realizado com sucesso", com a data no topo. */
export const EXPRESS_SUCCESS = [
  `IBAN: 005500003407497410108 03-11-2026 04:37:43
500294**tt*ttt*7396
PAGAMENTO REALIZADO
COM SUCESSO
9.900,00 Kz
MONTANTE
955567206
REFERÊNCIA
10116 - PAYPAY ÁFRICA
ENTIDADE
PAYPAY AFRICA
REFERÊNCIA: 955 567 206
MONTANTE: 9900.00
CARREGAMENTO
PAGO 042000000000132393988
INFORMAÇÃO
SALDO ACTUAL ***** /g\\`,
  `IBAN: 005500003407497410108 03-11-2026 04:37:43
500294******7396
PAGAMENTO REALIZADO
COM SUCESSO
9.900,00 Kz
MONTANTE
955567206
REFERÊNCIA
10116 - PAYPAY ÁFRICA
ENTIDADE
PAYPAY AFRICA
REFERENCIA: 955 567 206
MONTANTE: 9900.00
CARREGAMENTO
PAGO 042000000000132393988
INFORMAÇÃO
SALDO ACTUAL ***** /5\\`,
  `IBAN: 005500003407497410108 03-11-2026 04:37:43
500294 ******7396
PAGAMENTO REALIZADO
COM SUCESSO
9.900,00 Kz
MONTANTE
955567206
REFERENCIA
10116 - PAYPAY AFRICA
ENTIDADE
PAYPAY AFRICA
REFERENCIA: 955 567 206
MONTANTE: 9900.00
CARREGAMENTO
PAGO 042000000000132393988
INFORMAÇÃO
SALDO ACTUAL ***** /5\\`,
];

/** O mesmo ecrã com o topo cortado: não mostra a data do pagamento. */
export const EXPRESS_SUCCESS_SEM_DATA = EXPRESS_SUCCESS.map((t) => t.split("\n").slice(2).join("\n"));

/** Multicaixa Express, "detalhe do pagamento": valores a cinzento claro, só com horas e minutos. */
export const EXPRESS_DETAIL = [
  `21:39 2 e UEM
LE Cs8PNests
DETALHE DO PAGAMENTO
amam
5O0294*t*ttkX6755
Data-Hora | 2026-11-11 21:38
Montante (Kz) | 3.500,00
Estado | Sucesso
Transaccdo | 2457591
Entidade | 10116
Referéncia | 921411702
Utilizar novamente dados de pagamento`,
  `21:39 P wil LTE@
E C=sPrNess
DETALHE DO PAGAMENTO
O AraC X
500294******g5755
Data-Hora | 2026-11-11 21:38
Montante (Kz) | 3.500,00
Estado | Sucesso
Transacgdo | 2457591
Entidade | 10116
Referência | 921411702
Utilizar novamente dados de pagamento`,
  `21:39
DETALHE DO PAGAMENTO
500294******6755
Data-Hora | 2026-11-11 21:38
Montante (Kz) | 3.500,00
Estado | Sucesso
Transacção | 2457591
Entidade | 10116
Referência | 921411702`,
];

/** Comprovativo digital do Multicaixa Express, fotografado do leitor de PDF. */
export const EXPRESS_PDF = [
  `05:53 uw 56 ED
comprovativo 20261106 054901 38... + | X
Bate: 2026 11.06 05:40:01 WAT | 5] BAI
Detalhe da operação realizada através do canal MULTICAIXA Express.
Data - Hora 2026-11-06 05:48:54
Operação | Pagamento de Serviços
Entidade 10116 - PAYPAY ÁFRICA
Referência 927411146
Montante 3.500,00 Kz
Transacção 6722566
Descrição ** PAYPAY AFRICA REFERÊNCIA: 927 411 146 MONTANTE:
3500.00 CARREGAMENTO PAGO 042000000000073401498 **
Fique em casa. Use o BAIDIRECTO`,
  `05:53 a 5C ED
comprovativo 20261106 054901 38... x
gly aires ty =
= EBAl
Comprovativo Digital
Detalhe da operação realizada através do canal MULTICAIXA Express.
Data - Hora 2026-11-06 05:48:54
Operação Pagamento de Serviços
Entidade 10116 - PAYPAY AFRICA
Referéncia 927411146
Montante 3.500,00 Kz
Transacção 6722566
Descrição ** PAYPAY AFRICA REFERÊNCIA: 927 411 146 MONTANTE:
3500.00 CARREGAMENTO PAGO 042000000000073401498 **`,
  `Comprovativo Digital
Detalhe da operação realizada através do canal MULTICAIXA Express.
Data - Hora 2026-11-06 05:48:54
Operação Pagamento de Serviços
Entidade 10116 - PAYPAY ÁFRICA
Referência 927411146
Montante 3.500,00 Kz
Transacção 6722566
Descrição ** PAYPAY AFRICA REFERÊNCIA: 927 411 146 MONTANTE:
3500.00 CARREGAMENTO PAGO 042000000000073401498 **`,
];

/** BAI Directo: a entidade é "PAGAMENTOS POR REFERÊNCIA" e o serviço é que identifica o 10116. */
export const BAI_DIRECTO = [
  `[bi]
- 3 nã CHAVE: | 793964670
* ie
ers I 951808199
A operação que efectuou foi registada com sucesso através do serviço BAI Directo.
DADOS DO ORDENANTE
Nome do Ordenante: SOFTCLICNET COMERCIO E PREST SERV LDA
DADOS DA OPERAÇÃO
Número de Operação: 563558413
Entidade: PAGAMENTOS POR REFERÊNCIA
Produto: CARREGAMENTO
Serviço: PAYPAY AFRICA
Referência: 953281086
Montante: K29 900,00
Data do Pagamento: 05/11/2026 13:34:59
Cana Mobile Banking
Estado: Sucesso
Dados do recibo:
PAYPAY AFRICA
REFERÊNCIA: 953 281 086
MONTANTE: 9900.00
PAGO 042000000000136179473
Documento processado pelo BAI Directo em: 05/11/2026 13:35:52`,
  `A operação que efectuou foi registada com sucesso através do serviço BAI Directo.
DADOS DO ORDENANTE
Nome do Ordenante: SOFTCLICNET COMERCIO E PREST SERV LDA
DADOS DA OPERAÇÃO
Número de Operação: 563558413
Entidade: PAGAMENTOS POR REFERENCIA
Produto: CARREGAMENTO
Servigo: PAYPAY AFRICA
Referência: 953281086
Montante: Kz 9 900,00
Data do Pagamento: 05/11/2026 13:34:59
Canal: Mobile Banking
Estado: Sucesso
Dados do recibo:
PAYPAY AFRICA
REFERÊNCIA: 953 281 086
MONTANTE: 9900.00
PAGO 042000000000136179413`,
  `A operação que efectuou foi registada com sucesso através do serviço BAI Directo.
DADOS DA OPERAÇÃO
Número de Operação: 563558413
Entidade: PAGAMENTOS POR REFERÊNCIA
Produto: CARREGAMENTO
Serviço: PAYPAY AFRICA
Referência: 953281086
Montante: Kz 9 900,00
Data do Pagamento: 05/11/2026 13:34:59
Canal: Mobile Banking
Estado: Sucesso
Dados do recibo:
PAYPAY AFRICA
REFERÊNCIA: 953 281 086
MONTANTE: 9900.00
PAGO 042000000000136179413`,
];
