import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface SpendEvent {
  spendMicros: string;
  remainingMicros: string;
  state: string;
  ts: string;
}

export interface StateChangeEvent {
  previousState: string;
  newState: string;
  ts: string;
  budgetId: string;
}

export interface ResetEvent {
  newState: string;
  ts: string;
  budgetId: string;
}

export type BudgetStreamEvent =
  | { type: 'spend'; data: SpendEvent }
  | { type: 'state_change'; data: StateChangeEvent }
  | { type: 'reset'; data: ResetEvent };

@Injectable()
export class StreamService {
  private readonly subjects = new Map<string, Subject<BudgetStreamEvent>>();

  getOrCreate(budgetId: string): Subject<BudgetStreamEvent> {
    if (!this.subjects.has(budgetId)) {
      this.subjects.set(budgetId, new Subject<BudgetStreamEvent>());
    }
    return this.subjects.get(budgetId)!;
  }

  emit(budgetId: string, event: BudgetStreamEvent): void {
    this.subjects.get(budgetId)?.next(event);
  }

  cleanup(budgetId: string): void {
    const subject = this.subjects.get(budgetId);
    if (subject) {
      subject.complete();
      this.subjects.delete(budgetId);
    }
  }
}
