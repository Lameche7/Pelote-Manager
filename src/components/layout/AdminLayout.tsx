import { Outlet } from '@tanstack/react-router'
import { AdminSidebar } from './AdminSidebar'

/** Root layout for admin pages. */
export function AdminLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-muted/40">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
