import { JobsApp } from "@/components/jobs-app";
import { currentUser } from "@/lib/supabase/server";

/**
 * The server's only job here is saying who is signed in, so the header can
 * show it without a round trip from the browser. The proxy has already
 * redirected anonymous requests; RLS is the boundary either way.
 */
export default async function Page() {
  const user = await currentUser();
  return <JobsApp email={user?.email ?? ""} />;
}
