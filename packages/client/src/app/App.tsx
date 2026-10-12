import { useRoute } from './route';
import { Landing } from './Landing';
import { Rules } from './Rules';
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
    case 'rules': return <Rules />;
    default: return <Landing />;
  }
}
