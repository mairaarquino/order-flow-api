# ADR 002 — Idempotência e consistência do pagamento

- **Status:** Aceita
- **Data:** 2026-10-20
- **Decisores:** Responsável pelo projeto OrderFlow API

## Contexto

Uma repetição HTTP, concorrência entre instâncias ou perda de conexão pode fazer o cliente não saber se um pagamento foi autorizado. Reexecutar uma cobrança como se fosse uma operação nova pode gerar efeitos financeiros duplicados. Ao mesmo tempo, PostgreSQL e um provedor externo não participam de uma única transação distribuída.

## Alternativas consideradas

1. **Somente transação PostgreSQL:** bloquear o pedido e persistir o resultado atomicamente. Evita cobranças concorrentes locais, mas rollback no banco não desfaz uma autorização já realizada pelo provedor.
2. **Estado PROCESSING com worker/outbox e reconciliação:** confirmar a intenção no banco, chamar o provedor fora da transação e finalizar assincronamente. Melhora a recuperação operacional, mas exige worker, leases, observabilidade, reprocessamento e uma API assíncrona para o cliente.
3. **Transação local mais idempotência ponta a ponta:** manter a operação síncrona sob lock PostgreSQL e propagar uma chave determinística ao provedor. Repetições consultam o resultado local ou recuperam a mesma autorização no provedor.

## Decisão

Adotar a alternativa 3 para o escopo atual:

- `POST /orders/:id/pay` exige `Idempotency-Key`, vinculada a um único pedido.
- A transação bloqueia a linha do pedido com `SELECT FOR UPDATE`.
- Chave, resultado final e estado do pedido são confirmados na mesma transação.
- Repetição da chave/pedido reproduz a resposta salva; a mesma chave em outro pedido retorna conflito.
- A chave escopada ao pedido também é enviada ao gateway. O gateway simulado mantém o resultado por chave.
- Falhas antes do commit revertem o resultado local. Um retry com a mesma chave consulta o mesmo resultado no provedor e conclui a persistência sem uma segunda autorização.
- Recusas também são resultados idempotentes; uma nova tentativa após recusa deve usar nova chave. Pedido pago não aceita cobrança com outra chave.

## Consequências e recuperação de falhas parciais

Uma transação SQL não pode provar se um provedor autorizou a cobrança quando a resposta ou o commit se perde. A recuperação depende de o provedor aceitar uma chave idempotente durável e devolver o resultado original ao repetir a solicitação. O adaptador de produção deve mapear o contrato `PaymentGateway` para essa funcionalidade. Sem suporte idempotente no provedor, não há garantia de ausência de cobrança duplicada após uma falha parcial.

Não adicionamos `PROCESSING` nem reconciliação assíncrona neste momento: o protocolo síncrono com chave externa idempotente atende ao fluxo demonstrativo. A chamada externa ocorre enquanto a transação e o lock estão ativos, aumentando o tempo de retenção; um volume maior ou requisitos de recuperação operacional poderão justificar outbox, estado intermediário e worker.

## Validação

Testes unitários e testes de integração PostgreSQL cobrem chamadas simultâneas com mesma chave, chaves concorrentes, replay após conclusão, chave reutilizada em pedido diferente, gateway chamado uma única vez e recuperação após resposta perdida ou falha de persistência simuladas depois da autorização. Testes PostgreSQL requerem banco dedicado configurado em `ORDERFLOW_TEST_DATABASE_URL`.
