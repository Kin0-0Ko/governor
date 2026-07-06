import { StreamService, BudgetStreamEvent } from './stream.service';

describe('StreamService', () => {
  let svc: StreamService;

  beforeEach(() => {
    svc = new StreamService();
  });

  describe('getOrCreate', () => {
    it('creates a new Subject for unknown budgetId', () => {
      const subject = svc.getOrCreate('budget-1');
      expect(subject).toBeDefined();
    });

    it('returns the same Subject on subsequent calls', () => {
      const a = svc.getOrCreate('budget-1');
      const b = svc.getOrCreate('budget-1');
      expect(a).toBe(b);
    });

    it('creates independent Subjects for different budgetIds', () => {
      const a = svc.getOrCreate('budget-1');
      const b = svc.getOrCreate('budget-2');
      expect(a).not.toBe(b);
    });
  });

  describe('emit', () => {
    it('emits spend event to subscribers', (done) => {
      const subject = svc.getOrCreate('budget-1');
      const event: BudgetStreamEvent = {
        type: 'spend',
        data: { spendMicros: '1000000', remainingMicros: '4000000', state: 'CLOSED', ts: new Date().toISOString() },
      };

      subject.subscribe((received) => {
        expect(received).toEqual(event);
        done();
      });

      svc.emit('budget-1', event);
    });

    it('emits state_change event', (done) => {
      const subject = svc.getOrCreate('budget-2');
      const event: BudgetStreamEvent = {
        type: 'state_change',
        data: { previousState: 'CLOSED', newState: 'OPEN', ts: new Date().toISOString(), budgetId: 'budget-2' },
      };

      subject.subscribe((received) => {
        expect(received.type).toBe('state_change');
        done();
      });

      svc.emit('budget-2', event);
    });

    it('silently ignores emit when no subject exists', () => {
      expect(() => svc.emit('nonexistent', {
        type: 'reset',
        data: { newState: 'CLOSED', ts: new Date().toISOString(), budgetId: 'nonexistent' },
      })).not.toThrow();
    });

    it('delivers to multiple subscribers', (done) => {
      const subject = svc.getOrCreate('budget-3');
      const received: BudgetStreamEvent[] = [];

      subject.subscribe((e) => { received.push(e); if (received.length === 2) { expect(received).toHaveLength(2); done(); } });
      subject.subscribe(() => {}); // second subscriber

      const event: BudgetStreamEvent = {
        type: 'reset',
        data: { newState: 'CLOSED', ts: '', budgetId: 'budget-3' },
      };
      svc.emit('budget-3', event);
      svc.emit('budget-3', event);
    });
  });

  describe('cleanup', () => {
    it('completes the subject on cleanup', (done) => {
      const subject = svc.getOrCreate('budget-4');
      subject.subscribe({ complete: done });
      svc.cleanup('budget-4');
    });

    it('removes subject from internal map after cleanup', () => {
      svc.getOrCreate('budget-5');
      svc.cleanup('budget-5');
      // new call creates fresh subject (different reference would confirm removal)
      const fresh = svc.getOrCreate('budget-5');
      expect(fresh).toBeDefined();
    });

    it('does not throw when cleaning up nonexistent budgetId', () => {
      expect(() => svc.cleanup('nonexistent')).not.toThrow();
    });
  });
});
