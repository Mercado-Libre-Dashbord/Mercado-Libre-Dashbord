import "./globals.css";

export const metadata = { title: "Dashboard Rentabilidad ML" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <nav>
          <a href="/">Resumen</a>
          <a href="/productos">Productos</a>
          <a href="/ventas">Ventas</a>
          <a href="/tendencias">Tendencias</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
