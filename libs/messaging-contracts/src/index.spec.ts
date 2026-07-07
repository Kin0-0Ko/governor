import {
  RABBITMQ_EXCHANGE,
  RABBITMQ_EXCHANGE_DLX,
  RABBITMQ_QUEUE_SPEND,
  RABBITMQ_QUEUE_ALERTS,
  RABBITMQ_QUEUE_SPEND_DLQ,
  RABBITMQ_QUEUE_ALERTS_DLQ,
  spendQueueOptions,
  alertsQueueOptions,
} from './index';

describe('messaging-contracts — shared RabbitMQ topology (FR-011)', () => {
  it('derives DLX/DLQ names from the base exchange/queue names', () => {
    expect(RABBITMQ_EXCHANGE_DLX).toBe(`${RABBITMQ_EXCHANGE}.dlx`);
    expect(RABBITMQ_QUEUE_SPEND_DLQ).toBe(`${RABBITMQ_QUEUE_SPEND}.dlq`);
    expect(RABBITMQ_QUEUE_ALERTS_DLQ).toBe(`${RABBITMQ_QUEUE_ALERTS}.dlq`);
  });

  it.each([
    ['spendQueueOptions', spendQueueOptions, RABBITMQ_QUEUE_SPEND, RABBITMQ_QUEUE_SPEND_DLQ],
    ['alertsQueueOptions', alertsQueueOptions, RABBITMQ_QUEUE_ALERTS, RABBITMQ_QUEUE_ALERTS_DLQ],
  ])('%s declares a durable queue with DLX/DLQ arguments matching its own queue name', (_label, options, queueName, dlqName) => {
    expect(options.queue).toBe(queueName);
    expect(options.queueOptions.durable).toBe(true);
    expect(options.queueOptions.arguments['x-dead-letter-exchange']).toBe(RABBITMQ_EXCHANGE_DLX);
    expect(options.queueOptions.arguments['x-dead-letter-routing-key']).toBe(dlqName);
    expect(options.exchange).toBe(RABBITMQ_EXCHANGE);
  });
});
