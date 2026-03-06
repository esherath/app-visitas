export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "radial-gradient(circle at top left, rgba(0, 128, 96, 0.18), transparent 30%), linear-gradient(180deg, #f5f8fb 0%, #edf3f8 100%)",
        color: "#102033"
      }}
    >
      <section
        style={{
          maxWidth: 760,
          width: "100%",
          background: "rgba(255,255,255,0.9)",
          borderRadius: 28,
          padding: 32,
          boxShadow: "0 24px 80px rgba(16, 32, 51, 0.08)",
          border: "1px solid rgba(16, 32, 51, 0.08)"
        }}
      >
        <span
          style={{
            display: "inline-flex",
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(0, 128, 96, 0.1)",
            color: "#0b6b54",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase"
          }}
        >
          VField API
        </span>
        <h1 style={{ margin: "18px 0 12px", fontSize: 44, lineHeight: 1, letterSpacing: "-0.04em" }}>
          Gerenciador de Visitas em execucao.
        </h1>
        <p style={{ margin: 0, color: "#4b6077", lineHeight: 1.7 }}>
          A API esta online. Para gerenciar empresas e configuracoes pelo navegador, abra{" "}
          <a href="/painel" style={{ color: "#06785d", fontWeight: 700 }}>
            /painel
          </a>
          .
        </p>
      </section>
    </main>
  );
}
