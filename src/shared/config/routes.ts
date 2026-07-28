export const ROUTES = {
  home: "/",
  login: "/connexion",
  register: "/inscription",
  reservations: "/reservations",
  tournaments: "/tournois",
  admin: "/admin",
  adminUsers: "/admin/utilisateurs",
  adminReservations: "/admin/reservations",
  adminReservationOperations: "/admin/reservations/suivi",
  forbidden: "/acces-refuse",
  notFound: "*",
} as const;
