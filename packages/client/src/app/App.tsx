import { useRoute } from './route';
import { Landing } from './Landing';
import { Stats } from './Stats';
import { GameRoute, OfflineRoute } from './GameRoute';

const globalStyles = import.meta.glob(['../styles/tokens.css', '../styles/global.css'], { eager: true });
void globalStyles;
import './app.css';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'game': return <GameRoute key={route.gameId} gameId={route.gameId} />;
    case 'offline': return <OfflineRoute />;
    case 'stats': return <Stats />;
    default: return <Landing />;
  }
}
