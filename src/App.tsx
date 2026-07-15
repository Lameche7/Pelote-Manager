import "./App.css";
import { supabase } from "@/lib/supabase";

function App() {
  // Vérifie simplement que le client Supabase est bien initialisé.
  const isSupabaseReady = !!supabase;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui",
      }}
    >
      <section
        style={{
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <h1>🏓 Pelote Manager V2</h1>

        <p>Version 2.0.0-alpha.1</p>

        <hr style={{ margin: "2rem 0" }} />

        <h2>
          {isSupabaseReady
            ? "✅ Client Supabase initialisé"
            : "❌ Client Supabase indisponible"}
        </h2>

        <p>
          Les fondations de l'application sont opérationnelles.
        </p>
      </section>
    </main>
  );
}

export default App;