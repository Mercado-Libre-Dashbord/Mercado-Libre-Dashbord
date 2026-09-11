import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: ["/((?!api/auth|api/ml|api/set-password|login|set-password|_next/static|_next/image|favicon.ico).*)"],
};
