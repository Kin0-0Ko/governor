import { Controller, Get, Param, Sse, MessageEvent } from '@nestjs/common';
import { Observable, fromEvent, map } from 'rxjs';
import { StreamService, BudgetStreamEvent } from './stream.service';

@Controller('v1/stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  @Sse('budgets/:budgetId')
  streamBudget(@Param('budgetId') budgetId: string): Observable<MessageEvent> {
    const subject = this.streamService.getOrCreate(budgetId);

    return subject.asObservable().pipe(
      map((event: BudgetStreamEvent): MessageEvent => ({
        type: event.type,
        data: JSON.stringify(event.data),
      })),
    );
  }
}
