export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-semibold">FlowTrack - {tenant}</h1>
            <nav className="flex space-x-4">
              <a href={`/${tenant}/readings/entry`} className="text-gray-600 hover:text-gray-900">
                Entry
              </a>
              <a href={`/${tenant}/readings/bulk`} className="text-gray-600 hover:text-gray-900">
                Bulk Entry
              </a>
              <a href={`/${tenant}/readings/history`} className="text-gray-600 hover:text-gray-900">
                History
              </a>
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}