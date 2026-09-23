import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  // Redirect para /dashboard se autenticado é feito pelo middleware
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 light:bg-white">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-white light:text-gray-900">WA Intelligence</h1>
          <p className="text-sm text-gray-400 light:text-gray-500">Entre com sua conta</p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
