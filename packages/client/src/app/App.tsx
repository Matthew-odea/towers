import { useRoute } from './route';
import { Landing } from './Landing';
import { Stats } from './Stats';
import { GameRoute, OfflineRoute } from './GameRoute';
import '../styles/global.css';
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
