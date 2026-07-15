import { createBrowserRouter, RouterProvider } from "react-router-dom";

function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui",
      }}
    >
      <section style={{ textAlign: "center" }}>
        <h1>🏓 Pelote Manager V2</h1>
        <p>Accueil</p>
      </section>
    </main>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}