// Short explanations for limits the board cannot show by itself.
import { CP_CAP_PER_TYPE, type CpActionType } from '@towers/engine';

/**
 * When a stack is selected and CP remain, but the per-turn cap on Move (and maybe Withdraw) is
 * used up, nothing glows: say why, in one line.
 */
export function capHint(cp: number, capRemaining: Record<CpActionType, number>, selected: boolean): string | null {
  if (!selected || cp <= 0) return null;
  const move = capRemaining.move === 0;
  const withdraw = capRemaining.withdraw === 0;
  if (move && withdraw) return `Move and Withdraw used ${CP_CAP_PER_TYPE} times`;
  if (move) return `Move used ${CP_CAP_PER_TYPE} times this turn`;
  return null;
}
