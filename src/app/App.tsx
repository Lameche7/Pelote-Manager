import AppRouter from "./router";
import { AppProviders } from "./providers";

function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

export default App;
