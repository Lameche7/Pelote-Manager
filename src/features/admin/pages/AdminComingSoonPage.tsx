export function AdminComingSoonPage({ title }: { title: string }) {
  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Administration</p>
        <h1>{title}</h1>
      </header>
      <div className="admin-card">
        <h2>Fonctionnalité prochainement disponible.</h2>
        <p className="admin-page__lead">
          Le module est déjà intégré à la navigation et pourra évoluer sans
          modifier la structure du Back Office.
        </p>
      </div>
    </section>
  );
}
