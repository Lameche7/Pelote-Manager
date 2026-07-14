import { Link, useLocation } from '@tanstack/react-router'
import { Trophy, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NAV_LINKS = [
  { to: '/', label: 'Accueil' },
  { to: '/tournoi', label: 'Tournoi' },
  { to: '/reservations', label: 'Réservations' },
]

/** Public-facing top navigation bar. */
export function PublicNavbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()

  return (
    <header className="sticky top-0 z-40 border-b bg-white shadow-sm">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link to={'/' as string} className="flex items-center gap-2 font-bold text-primary">
          <Trophy className="h-6 w-6" />
          <span>PCL Lourdais</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to as string}
              className={cn(
                'text-sm font-medium transition-colors hover:text-primary',
                pathname === to ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {label}
            </Link>
          ))}
          <Link to={'/admin/login' as string}>
            <Button variant="outline" size="sm">
              Administration
            </Button>
          </Link>
        </nav>

        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="border-t bg-white md:hidden">
          <div className="container mx-auto flex flex-col gap-1 px-4 py-3">
            {NAV_LINKS.map(({ to, label }) => (
              <Link
                key={to}
                to={to as string}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted',
                  pathname === to ? 'bg-muted text-primary' : 'text-muted-foreground',
                )}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </Link>
            ))}
            <Link to={'/admin/login' as string} onClick={() => setMenuOpen(false)}>
              <Button variant="outline" size="sm" className="mt-2 w-full">
                Administration
              </Button>
            </Link>
          </div>
        </nav>
      )}
    </header>
  )
}
