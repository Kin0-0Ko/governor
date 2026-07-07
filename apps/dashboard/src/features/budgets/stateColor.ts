export type CircuitStateColor = 'success' | 'danger' | 'warning' | 'default';

export function stateColor(state: string | undefined): CircuitStateColor {
  switch (state) {
    case 'CLOSED':
      return 'success';
    case 'OPEN':
      return 'danger';
    case 'HALF_OPEN':
      return 'warning';
    default:
      return 'default';
  }
}

export function formatUsd(micros: string | undefined): string {
  if (!micros) return '$0.00';
  return `$${(Number(BigInt(micros)) / 1_000_000).toFixed(2)}`;
}
