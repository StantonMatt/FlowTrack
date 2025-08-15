'use client';

import { useState } from 'react';

interface PageProps {
  params: { tenant: string };
}

export default function ReadingEntryPage({ params }: PageProps) {
  const [reading, setReading] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Listen for online/offline events
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => setIsOffline(false));
    window.addEventListener('offline', () => setIsOffline(true));
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Reading submitted: ${reading}\nPhoto: ${photo?.name || 'No photo'}\nMode: ${isOffline ? 'Offline (queued)' : 'Online'}`);
  };

  return (
    <div className="container mx-auto py-6 px-4 max-w-md">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Reading Entry</h1>
        <p className="text-gray-600">
          Mobile-optimized form for meter reading collection
        </p>
        {isOffline && (
          <div className="mt-2 p-2 bg-yellow-100 text-yellow-800 rounded">
            📡 Offline Mode - Readings will be queued
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Customer Account
          </label>
          <select className="w-full p-3 border rounded-lg">
            <option>ACC-001 - John Doe</option>
            <option>ACC-002 - Jane Smith</option>
            <option>ACC-003 - Bob Johnson</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Meter Reading
          </label>
          <input
            type="number"
            value={reading}
            onChange={(e) => setReading(e.target.value)}
            className="w-full p-3 border rounded-lg text-lg"
            placeholder="Enter reading value"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Photo Capture
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            {photo ? (
              <div>
                <p className="text-sm text-green-600">✅ Photo captured</p>
                <p className="text-xs text-gray-500">{photo.name}</p>
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="mt-2 text-sm text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                  className="hidden"
                  id="photo-input"
                />
                <label
                  htmlFor="photo-input"
                  className="cursor-pointer inline-flex items-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  📷 Capture Photo
                </label>
                <p className="text-xs text-gray-500 mt-2">
                  Tap to take photo or upload
                </p>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Notes (Optional)
          </label>
          <textarea
            className="w-full p-3 border rounded-lg"
            rows={3}
            placeholder="Any additional notes..."
          />
        </div>

        <button
          type="submit"
          className="w-full py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium"
        >
          Submit Reading
        </button>
      </form>

      <div className="mt-8 p-4 bg-gray-100 rounded-lg">
        <h3 className="font-medium mb-2">Recent Submissions</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>ACC-001</span>
            <span>12345 - 2 mins ago</span>
          </div>
          <div className="flex justify-between">
            <span>ACC-003</span>
            <span>12300 - 15 mins ago</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>ACC-002</span>
            <span>12280 - Queued (offline)</span>
          </div>
        </div>
      </div>
    </div>
  );
}