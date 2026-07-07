export {
  RABBITMQ_EXCHANGE,
  RABBITMQ_EXCHANGE_DLX,
  RABBITMQ_QUEUE_SPEND,
  RABBITMQ_QUEUE_ALERTS,
  RABBITMQ_QUEUE_SPEND_DLQ,
  RABBITMQ_QUEUE_ALERTS_DLQ,
  RABBITMQ_ROUTING_SPEND,
  RABBITMQ_ROUTING_ALERT,
  rabbitmqUrl,
  spendQueueOptions as rabbitmqOptions,
  alertsQueueOptions,
} from '@governor/messaging-contracts';
