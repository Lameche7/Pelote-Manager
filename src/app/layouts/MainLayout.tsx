import { Outlet } from "react-router-dom";
import { APP_CONFIG } from "@/shared/config";

export function MainLayout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <span className="app-header__name">{APP_CONFIG.name}</span>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <small>
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </small>
      </footer>
    </div>
  );
}
