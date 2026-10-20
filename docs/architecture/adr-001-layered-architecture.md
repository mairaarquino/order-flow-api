# ADR 001 — Arquitetura modular em camadas e pagamentos transacionais

- **Status:** Aceita
- **Data:** 2026-10-20
- **Decisores:** Responsável pelo projeto OrderFlow API

## Contexto e decisão

O sistema separa `Domain`, `Application`, `Infrastructure` e `Presentation`, mantendo as dependências apontadas às regras internas. `src/main.ts` é o ponto explícito de composição. Contratos de repositório e gateway pertencem à Application; PostgreSQL, HTTP e o gateway simulado são detalhes externos.

Pedidos são criados em `pending_payment`. A única transição implementada é `pending_payment -> paid`, realizada por `Order.markAsPaid()`. Qualquer tentativa de pagar novamente ou transição incompatível é rejeitada. Uma recusa do provedor não altera o estado.

## Persistência e transação

PostgreSQL é a implementação de persistência padrão. A migration `001_create_orders_and_payment_idempotency.sql` cria pedidos com valores monetários inteiros em centavos, estado limitado por `CHECK` e uma tabela de resultados de idempotência.

O pagamento é executado em uma transação PostgreSQL. A linha do pedido é lida com `SELECT ... FOR UPDATE`, serializando pagamentos concorrentes do mesmo pedido. A chave idempotente e sua resposta final são gravadas na mesma transação que a mudança de estado. Uma chave repetida retorna o resultado armazenado; uma chave vinculada a outro pedido conflita. Falha do gateway ou do processamento reverte a transação, permitindo repetição segura da operação.

Migrations são ordenadas e registradas em `schema_migrations`; um advisory lock evita que dois processos de migration apliquem o mesmo arquivo simultaneamente. Cada migration e seu registro são confirmados atomicamente.

## Idempotência e integração externa

`POST /orders/:id/pay` exige `Idempotency-Key` (1–200 caracteres). O valor é associado ao pedido e também encaminhado ao gateway em escopo do pedido. O adaptador simulado memoiza resultados para representar o comportamento esperado de um provedor idempotente.

O bloqueio de linha e a transação impedem cobranças concorrentes através deste serviço, mas uma transação SQL não pode tornar atômica uma chamada de rede externa. Em produção, o provedor precisa implementar idempotência e aceitar a chave encaminhada para cobrir falhas após a autorização externa e antes do commit local. Não se afirma garantia de “exactly once” sem essa cooperação.

Resultados de recusa também são armazenados para a mesma chave. Uma nova tentativa de cobrança após recusa deve usar uma nova chave. Um pedido já pago não pode ser cobrado com uma chave diferente.

## Consequências e limites

- Os casos de uso continuam testáveis sem servidor ou banco; contratos têm substitutos em memória nos testes.
- O adaptador PostgreSQL mantém persistência e coordenação transacional fora do domínio.
- O gateway é chamado enquanto a transação e o lock do pedido estão ativos; gateways lentos aumentam o tempo de retenção do lock.
- Estoque, expiração de pedidos, pagamentos assíncronos, outbox, compensação e integração com provedor real não fazem parte desta implementação.
- A tabela de idempotência não tem política de expiração nesta versão; resultados devem ser retidos enquanto forem necessários para replay.

## Validação

Testes unitários cobrem invariantes, recusa, pedido inexistente, replay, chave conflitante e falha de gateway. Testes de integração opcionais validam idempotência e concorrência contra PostgreSQL. O teste arquitetural verifica que Domain e Application não importam Infrastructure ou frameworks HTTP.
