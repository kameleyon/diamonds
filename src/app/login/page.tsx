import { LoginForm } from "./login-form";
import { isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const configured = isAuthConfigured();

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[1400px] items-center px-5">
      <div className="max-w-[46ch]">
        <h1 className="text-[22px] text-bone">Diamonds</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-bone-dim">
          A personal terminal with one account. Access is limited to a named list of
          addresses, so signing in with any other account is refused even when the credentials
          themselves are valid.
        </p>

        {configured ? (
          <LoginForm />
        ) : (
          <div className="mt-6 border-l-2 border-brick-dim pl-3">
            <p className="text-[13px] leading-relaxed text-bone-dim">
              Sign-in is not configured. Set{" "}
              <code className="num text-bone">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
              <code className="num text-bone">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> and{" "}
              <code className="num text-bone">DIAMONDS_OWNER_EMAILS</code> in{" "}
              <code className="num text-bone">.env.local</code>.
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-bone-faint">
              With no allowlist set, nothing is authorised — the app fails closed rather than
              open.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
