import { NavLink, Outlet } from "react-router-dom";
import { adminNavigation } from "@/features/admin/config/adminPermissions";
import "./AdminShell.css";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `admin-shell__link${isActive ? " admin-shell__link--active" : ""}`;

export function AdminShell() {
  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar">
        <header>
          <span>Back Office</span>
          <strong>Administration</strong>
        </header>
        <nav aria-label="Navigation de l’administration">
          {adminNavigation.map((item) =>
            "children" in item ? (
              <section key={item.label} className="admin-shell__group">
                <p>{item.label}</p>
                {item.children.map((child) => (
                  <NavLink key={child.to} className={linkClass} to={child.to}>
                    {child.label}
                  </NavLink>
                ))}
              </section>
            ) : (
              <NavLink
                key={item.to}
                className={linkClass}
                to={item.to}
                end={item.to === "/admin"}
              >
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
      </aside>
      <main className="admin-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
