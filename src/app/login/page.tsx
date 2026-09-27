import { Suspense } from "react";

import { LoginCard } from "./login-card";

export const metadata = { title: "Sign in · Trueward Search" };

export default function LoginPage() {
  // LoginCard reads `next` through useSearchParams, which opts its subtree
  // into client rendering; without this boundary Next refuses to prerender.
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
