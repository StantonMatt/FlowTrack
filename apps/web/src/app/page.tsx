import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="pt-20 pb-12 text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            FlowTrack
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Modern Water Utility Management System
          </p>
          
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-semibold mb-4">Test the Application</h2>
              <p className="text-gray-600 mb-6">
                Explore the features without authentication. Use "demo" as the tenant ID.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Link
                  href="/demo/readings/entry"
                  className="block p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-center"
                >
                  <div className="font-semibold">Reading Entry</div>
                  <div className="text-sm mt-1">Mobile-optimized form</div>
                </Link>
                
                <Link
                  href="/demo/readings/bulk"
                  className="block p-4 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-center"
                >
                  <div className="font-semibold">Bulk Entry</div>
                  <div className="text-sm mt-1">Excel-like grid</div>
                </Link>
                
                <Link
                  href="/demo/readings/history"
                  className="block p-4 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-center"
                >
                  <div className="font-semibold">History</div>
                  <div className="text-sm mt-1">View past readings</div>
                </Link>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold mb-3">Key Features</h3>
              <ul className="text-left space-y-2 text-gray-600">
                <li>✅ Offline-first PWA with service worker</li>
                <li>✅ Photo capture for meter readings</li>
                <li>✅ Bulk data entry with validation</li>
                <li>✅ Anomaly detection system</li>
                <li>✅ Multi-tenant architecture</li>
                <li>✅ Automated billing & invoicing</li>
                <li>✅ Real-time sync when online</li>
              </ul>
            </div>
            
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold mb-3">Admin Access</h3>
              <Link
                href="/admin"
                className="inline-block px-6 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
              >
                Admin Dashboard
              </Link>
              <p className="text-sm text-gray-500 mt-2">
                (Authentication required)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}