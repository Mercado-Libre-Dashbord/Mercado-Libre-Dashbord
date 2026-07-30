import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./AuthProvider";
import { NavBar } from "./NavBar";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = { title: "Dashboard Rentabilidad ML" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body>
        <AuthProvider>
          <div className="app-shell">
            <NavBar />
            <main>{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
