import { supabase } from "@/lib/supabase";

function App() {
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
          maxWidth: "640px",
        }}
      >
        <h1>🏓 Pelote Manager V2</h1>

        <p>Application Shell</p>

        <hr style={{ margin: "2rem 0" }} />

        <p>
          <strong>Version :</strong> 2.0.0-alpha.2
        </p>

        <p>
          <strong>Architecture :</strong> DSFT v2.0
        </p>

        <p>
          <strong>Supabase :</strong>{" "}
          {isSupabaseReady ? "✅ Initialisé" : "❌ Indisponible"}
        </p>
      </section>
    </main>
  );
}

export default App;