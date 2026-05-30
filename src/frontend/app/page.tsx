import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center sm:p-20 font-[family-name:var(--font-geist-sans)] dark:bg-black">
      <h1 className="text-4xl font-bold mb-4 dark:text-zinc-50">Anchor</h1>
      <p className="text-xl text-gray-600 dark:text-gray-300 mb-12">100% On-Device AI Companion</p>
      
      <div className="flex flex-col sm:flex-row gap-6">
        <Link 
          href="/patient"
          className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] text-lg h-12 px-8"
        >
          Open Companion (Patient)
        </Link>
        <Link 
          href="/caregiver"
          className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] dark:text-zinc-100 transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent text-lg h-12 px-8"
        >
          Caregiver Dashboard
        </Link>
      </div>
    </div>
  );
}
