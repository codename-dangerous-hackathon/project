export default function PatientPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 text-white p-8">
      {/* Voice-First, high contrast, low cognitive load UI */}
      <h1 className="text-6xl font-bold mb-12 text-center">Hello</h1>
      
      <button className="bg-blue-600 hover:bg-blue-500 rounded-full h-48 w-48 flex items-center justify-center text-3xl font-semibold shadow-xl transition-transform active:scale-95">
        Who is this?
      </button>

      <div className="mt-16 text-3xl text-zinc-400 text-center">
        Tap the button and point the camera
      </div>
    </main>
  );
}
