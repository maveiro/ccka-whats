import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import LoginForm from "./login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-white">WA Intelligence</h1>
          <p className="text-sm text-gray-400">Entre com sua conta</p>
        </div>
        <LoginForm />
        <p className="text-center text-sm text-gray-500">
          Não tem conta?{" "}
          <Link href="/register" className="text-green-400 hover:underline">
            Criar conta →
          </Link>
        </p>
      </div>
    </div>
  );
}
