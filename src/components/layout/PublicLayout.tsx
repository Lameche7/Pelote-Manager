import { Outlet } from '@tanstack/react-router'
import { PublicNavbar } from './PublicNavbar'

/** Root layout for public pages. */
export function PublicLayout() {
  return (
    <div className="min-h-screen bg-background">
      <PublicNavbar />
      <main>
        <Outlet />
      </main>
      <footer className="border-t bg-muted py-6 mt-16">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} PCL Lourdais – Tous droits réservés
        </div>
      </footer>
    </div>
  )
}
