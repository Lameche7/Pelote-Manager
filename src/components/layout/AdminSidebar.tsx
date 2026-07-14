import { useLocation, useNavigate } from '@tanstack/react-router'
import {
  Settings,
  Users,
  Grid3X3,
  CalendarDays,
  Trophy,
  LogOut,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { signOut } from '@/services/auth.service'
import { useAuth } from '@/features/auth/AuthProvider'
import { toast } from 'sonner'
import { Link } from '@tanstack/react-router'

const ADMIN_NAV = [
  { to: '/admin/parametres', label: 'Paramètres', icon: Settings },
  { to: '/admin/equipes', label: 'Équipes', icon: Users },
  { to: '/admin/poules', label: 'Poules', icon: Grid3X3 },
  { to: '/admin/planning', label: 'Planning', icon: CalendarDays },
  { to: '/admin/resultats', label: 'Résultats', icon: Trophy },
]

/** Sidebar navigation for the admin area. */
export function AdminSidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()

  async function handleSignOut() {
    try {
      await signOut()
      void navigate({ to: '/admin/login' as string })
    } catch {
      toast.error('Erreur lors de la déconnexion')
    }
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6 font-bold text-primary">
        <Trophy className="h-6 w-6" />
        <span>Administration</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {ADMIN_NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to)
          return (
            <Link
              key={to}
              to={to as string}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {active && <ChevronRight className="ml-auto h-4 w-4" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-4">
        <div className="mb-2 truncate text-xs text-muted-foreground">{user?.email}</div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
          Déconnexion
        </Button>
      </div>
    </aside>
  )
}
