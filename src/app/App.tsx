import AppRouter from "./router";
import { AppProviders } from "./providers";
import { MarketingPage } from "@/features/marketing/pages/MarketingPage";

function shouldShowMarketingSite() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host === "www.pelotemanager.fr" || window.location.pathname === "/presentation";
}

function App() {
  if (shouldShowMarketingSite()) {
    return <MarketingPage />;
  }

  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

export default App;
