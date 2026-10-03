import type { PlayerId } from '@towers/engine';
export const factionName = (p: PlayerId) => (p === 'red' ? 'Kholin' : 'Singers');
