import Link from 'next/link';
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react';
import { AUTH_DISABLED } from '@/lib/auth-bypass';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 px-6 py-16 text-gray-900">
      <div className="mx-auto flex min-h-[70vh] max-w-4xl flex-col items-center justify-center text-center">
        <div className="mb-6 flex items-center gap-2 rounded-full bg-violet-100 px-4 py-2 text-sm font-semibold text-violet-700">
          <Sparkles size={16} /> DukaanAI retail workspace
        </div>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">Run your retail business with clarity.</h1>
        <p className="mt-6 max-w-2xl text-lg text-gray-600">Explore the workspace without an account. Sign in only when you are ready to access your shop data, billing, inventory, and saved work.</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white shadow-lg shadow-violet-200 transition-colors hover:bg-violet-700">Explore workspace <ArrowRight size={18} /></Link>
          {!AUTH_DISABLED && (
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 font-semibold text-gray-800 transition-colors hover:bg-gray-50"><LockKeyhole size={17} /> Sign in</Link>
          )}
        </div>
      </div>
    </main>
  );
}
