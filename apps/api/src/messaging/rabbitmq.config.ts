export const RABBITMQ_EXCHANGE = 'governor.events';
export const RABBITMQ_QUEUE_SPEND = 'governor.spend';
export const RABBITMQ_QUEUE_ALERTS = 'governor.alerts';
export const RABBITMQ_ROUTING_SPEND = 'spend.recorded';
export const RABBITMQ_ROUTING_ALERT = 'budget.breached';

export const rabbitmqUrl = process.env['RABBITMQ_URL'] ?? 'amqp://guest:guest@localhost:5672';

export const rabbitmqOptions = {
  urls: [rabbitmqUrl],
  queue: RABBITMQ_QUEUE_SPEND,
  queueOptions: {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': `${RABBITMQ_EXCHANGE}.dlx`,
      'x-dead-letter-routing-key': `${RABBITMQ_QUEUE_SPEND}.dlq`,
    },
  },
  exchange: RABBITMQ_EXCHANGE,
  exchangeType: 'topic' as const,
  noAck: false,
};
