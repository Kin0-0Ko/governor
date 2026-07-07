import { Controller, Param, Req, Sse, MessageEvent } from '@nestjs/common';
import { Request } from 'express';
import { Observable, map, finalize } from 'rxjs';
import { StreamService, BudgetStreamEvent } from './stream.service';
import { BudgetsService } from '../budgets/budgets.service';

interface AuthedRequest extends Request {
  orgId: string;
}

@Controller('v1/stream')
export class StreamController {
  constructor(
    private readonly streamService: StreamService,
    private readonly budgetsService: BudgetsService,
  ) {}

  @Sse('budgets/:budgetId')
  async streamBudget(
    @Param('budgetId') budgetId: string,
    @Req() req: AuthedRequest,
  ): Promise<Observable<MessageEvent>> {
    // Throws (propagates as an error response) if the budget doesn't exist or
    // belongs to a different org — no subscription is created in that case.
    await this.budgetsService.findById(budgetId, req.orgId);

    const subject = this.streamService.getOrCreate(budgetId);

    return subject.asObservable().pipe(
      map((event: BudgetStreamEvent): MessageEvent => ({
        type: event.type,
        data: JSON.stringify(event.data),
      })),
      finalize(() => this.streamService.cleanup(budgetId)),
    );
  }
}
