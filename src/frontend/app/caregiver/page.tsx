export default function CaregiverPage() {
  return (
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Caregiver Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="border p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Enroll Face</h2>
          <p className="text-sm text-gray-600 mb-4">Add a family member to the local vision model.</p>
          <button className="bg-black text-white px-4 py-2 rounded-md">Upload Photo</button>
        </section>

        <section className="border p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Daily Summary</h2>
          <p className="text-sm text-gray-600 mb-4">Generated locally by Nemotron.</p>
          <div className="bg-gray-50 p-4 rounded-md text-sm">
            No interactions logged yet today.
          </div>
        </section>
      </div>
    </main>
  );
}
