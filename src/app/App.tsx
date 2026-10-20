import AppRouter from "./router";
import { AppProviders } from "./providers";
import { MarketingPage } from "@/features/marketing/pages/MarketingPage";
import { MARKETING_PREVIEW_PATH } from "@/shared/config/domains";

function shouldShowMarketingSite() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === MARKETING_PREVIEW_PATH;
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
