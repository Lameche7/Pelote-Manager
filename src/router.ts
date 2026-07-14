import { createRouter, createRoute, createRootRoute, redirect, Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { PublicHomePage } from '@/features/tournament/PublicHomePage'
import { PublicTournamentPage } from '@/features/tournament/PublicTournamentPage'
import { ReservationsPage } from '@/features/reservations/ReservationsPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { AdminSettingsPage } from '@/features/tournament/AdminSettingsPage'
import { AdminTeamsPage } from '@/features/teams/AdminTeamsPage'
import { AdminPoolsPage } from '@/features/pools/AdminPoolsPage'
import { AdminPlanningPage } from '@/features/planning/AdminPlanningPage'
import { AdminResultsPage } from '@/features/results/AdminResultsPage'
import { TVDisplayPage } from '@/features/tv/TVDisplayPage'
import { getSession } from '@/services/auth.service'
import { createElement } from 'react'

// ─── Root ─────────────────────────────────────────────────────────────────

const rootRoute = createRootRoute({
  component: () => createElement('div', null,
    createElement(Outlet),
    createElement(Toaster, { richColors: true, position: 'top-right' })
  ),
})

// ─── Public routes ────────────────────────────────────────────────────────

const publicLayoutRoute = createRoute({
  id: 'public-layout',
  getParentRoute: () => rootRoute,
  component: PublicLayout,
})

const indexRoute = createRoute({
  path: '/',
  getParentRoute: () => publicLayoutRoute,
  component: PublicHomePage,
})

const tournoiRoute = createRoute({
  path: '/tournoi',
  getParentRoute: () => publicLayoutRoute,
  component: PublicTournamentPage,
})

const reservationsRoute = createRoute({
  path: '/reservations',
  getParentRoute: () => publicLayoutRoute,
  component: ReservationsPage,
})

// ─── Auth ─────────────────────────────────────────────────────────────────

const adminLoginRoute = createRoute({
  path: '/admin/login',
  getParentRoute: () => rootRoute,
  component: LoginPage,
})

// ─── Admin protected layout ───────────────────────────────────────────────

const adminLayoutRoute = createRoute({
  id: 'admin-layout',
  path: '/admin',
  getParentRoute: () => rootRoute,
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/admin/login' })
  },
  component: AdminLayout,
})

const adminIndexRoute = createRoute({
  path: '/',
  getParentRoute: () => adminLayoutRoute,
  beforeLoad: () => { throw redirect({ to: '/admin/parametres' }) },
  component: () => null,
})

const adminParametresRoute = createRoute({
  path: '/parametres',
  getParentRoute: () => adminLayoutRoute,
  component: AdminSettingsPage,
})

const adminEquipesRoute = createRoute({
  path: '/equipes',
  getParentRoute: () => adminLayoutRoute,
  component: AdminTeamsPage,
})

const adminPoulesRoute = createRoute({
  path: '/poules',
  getParentRoute: () => adminLayoutRoute,
  component: AdminPoolsPage,
})

const adminPlanningRoute = createRoute({
  path: '/planning',
  getParentRoute: () => adminLayoutRoute,
  component: AdminPlanningPage,
})

const adminResultatsRoute = createRoute({
  path: '/resultats',
  getParentRoute: () => adminLayoutRoute,
  component: AdminResultsPage,
})

// ─── TV Mode ──────────────────────────────────────────────────────────────

const tvRoute = createRoute({
  path: '/tv',
  getParentRoute: () => rootRoute,
  component: TVDisplayPage,
})

// ─── Route tree ───────────────────────────────────────────────────────────

const routeTree = rootRoute.addChildren([
  publicLayoutRoute.addChildren([indexRoute, tournoiRoute, reservationsRoute]),
  adminLoginRoute,
  adminLayoutRoute.addChildren([
    adminIndexRoute,
    adminParametresRoute,
    adminEquipesRoute,
    adminPoulesRoute,
    adminPlanningRoute,
    adminResultatsRoute,
  ]),
  tvRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
