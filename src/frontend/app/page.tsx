import Link from "next/link";

const PRIMARY =
  "flex flex-col items-center justify-center gap-2 rounded-3xl bg-foreground text-background py-8 px-4 text-center shadow-sm hover:opacity-90 active:scale-95 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-400";
const SECONDARY =
  "flex flex-col items-center justify-center gap-2 rounded-3xl border border-black/10 dark:border-white/15 dark:text-zinc-100 py-8 px-4 text-center hover:bg-black/[.03] dark:hover:bg-white/[.06] active:scale-95 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-400";

const LINKS = [
  { href: "/patient", icon: "🎙️", label: "Voice Companion", hint: "Talk with Belong", style: PRIMARY },
  { href: "/hermes", icon: "💬", label: "Text Chat", hint: "Chat with Hermes", style: PRIMARY },
  { href: "/map", icon: "🗺️", label: "City Services Map", hint: "Find places nearby", style: SECONDARY },
  { href: "/caregiver", icon: "🩺", label: "Caregiver Dashboard", hint: "Manage care", style: SECONDARY },
];

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-8 sm:p-12 text-center bg-[linear-gradient(to_bottom,#4aacaa_0%,#ffffff_100%)] dark:bg-[linear-gradient(to_bottom,#15605e_0%,#0a0a0a_100%)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-512x512.svg" alt="Belong logo" width={128} height={128} className="w-28 h-28 mb-5" />
      <h1 className="text-4xl font-bold mb-2 dark:text-zinc-50">Belong</h1>
      <p className="text-xl text-gray-700 dark:text-gray-300 mb-10">100% On-Device AI Companion</p>

      <div className="grid grid-cols-2 gap-4 w-full max-w-xl">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={l.style}>
            <span className="text-5xl" aria-hidden>{l.icon}</span>
            <span className="text-lg sm:text-xl font-semibold leading-tight">{l.label}</span>
            <span className="text-sm opacity-80">{l.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
