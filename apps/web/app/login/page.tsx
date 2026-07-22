import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  // Redirect para /dashboard se autenticado é feito pelo middleware
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-white">WA Intelligence</h1>
          <p className="text-sm text-gray-400">Entre com sua conta</p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
