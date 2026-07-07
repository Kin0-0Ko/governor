export const RABBITMQ_EXCHANGE = 'governor.events';
export const RABBITMQ_EXCHANGE_DLX = `${RABBITMQ_EXCHANGE}.dlx`;
export const RABBITMQ_QUEUE_SPEND = 'governor.spend';
export const RABBITMQ_QUEUE_ALERTS = 'governor.alerts';
export const RABBITMQ_QUEUE_SPEND_DLQ = `${RABBITMQ_QUEUE_SPEND}.dlq`;
export const RABBITMQ_QUEUE_ALERTS_DLQ = `${RABBITMQ_QUEUE_ALERTS}.dlq`;
export const RABBITMQ_ROUTING_SPEND = 'spend.recorded';
export const RABBITMQ_ROUTING_ALERT = 'budget.breached';

export const rabbitmqUrl = process.env['RABBITMQ_URL'] ?? 'amqp://governor:governor_dev@localhost:5672';

/**
 * Single source of truth for the spend queue's declaration. Both apps/api (publisher)
 * and apps/worker (consumer) MUST use this exact object — RabbitMQ rejects
 * re-declaration of an existing queue with mismatched arguments (PRECONDITION_FAILED).
 */
export const spendQueueOptions = {
  urls: [rabbitmqUrl],
  queue: RABBITMQ_QUEUE_SPEND,
  queueOptions: {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': RABBITMQ_EXCHANGE_DLX,
      'x-dead-letter-routing-key': RABBITMQ_QUEUE_SPEND_DLQ,
    },
  },
  exchange: RABBITMQ_EXCHANGE,
  exchangeType: 'topic' as const,
  noAck: false,
};

export const alertsQueueOptions = {
  urls: [rabbitmqUrl],
  queue: RABBITMQ_QUEUE_ALERTS,
  queueOptions: {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': RABBITMQ_EXCHANGE_DLX,
      'x-dead-letter-routing-key': RABBITMQ_QUEUE_ALERTS_DLQ,
    },
  },
  exchange: RABBITMQ_EXCHANGE,
  exchangeType: 'topic' as const,
  noAck: false,
};
