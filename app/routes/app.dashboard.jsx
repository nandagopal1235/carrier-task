import { Outlet, useNavigate, useLocation } from "react-router";

export default function DashboardLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const activeTab =
    pathname.endsWith("/products")
      ? "products"
      : pathname.endsWith("/orders")
      ? "orders"
      : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f4f6f8",
        padding: 32,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: 14,
          boxShadow: "0 12px 28px rgba(0,0,0,0.08)",
          padding: 28,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
          }}
        >
          <h1 style={{ margin: 0 }}>Dashboard</h1>

          <nav style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => navigate("/app/dashboard/products")}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background:
                  activeTab === "products" ? "#2563eb" : "#e5e7eb",
                color:
                  activeTab === "products" ? "#ffffff" : "#111827",
                fontWeight: 600,
              }}
            >
              Products
            </button>

            <button
              onClick={() => navigate("/app/dashboard/orders")}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background:
                  activeTab === "orders" ? "#2563eb" : "#e5e7eb",
                color:
                  activeTab === "orders" ? "#ffffff" : "#111827",
                fontWeight: 600,
              }}
            >
              Orders
            </button>
          </nav>
        </header>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
