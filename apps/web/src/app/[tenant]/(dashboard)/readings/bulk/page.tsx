'use client';

import { useState } from 'react';

interface PageProps {
  params: { tenant: string };
}

interface Reading {
  id: number;
  account: string;
  customerName: string;
  previousReading: number;
  currentReading: number;
  consumption: number;
  notes: string;
}

export default function BulkReadingEntryPage({ params }: PageProps) {
  const [readings, setReadings] = useState<Reading[]>([
    { id: 1, account: 'ACC-001', customerName: 'John Doe', previousReading: 12000, currentReading: 0, consumption: 0, notes: '' },
    { id: 2, account: 'ACC-002', customerName: 'Jane Smith', previousReading: 11800, currentReading: 0, consumption: 0, notes: '' },
    { id: 3, account: 'ACC-003', customerName: 'Bob Johnson', previousReading: 12300, currentReading: 0, consumption: 0, notes: '' },
    { id: 4, account: 'ACC-004', customerName: 'Alice Brown', previousReading: 11500, currentReading: 0, consumption: 0, notes: '' },
    { id: 5, account: 'ACC-005', customerName: 'Charlie Wilson', previousReading: 12100, currentReading: 0, consumption: 0, notes: '' },
  ]);

  const updateReading = (id: number, field: keyof Reading, value: any) => {
    setReadings(prev => prev.map(r => {
      if (r.id === id) {
        const updated = { ...r, [field]: value };
        if (field === 'currentReading') {
          updated.consumption = Math.max(0, Number(value) - r.previousReading);
        }
        return updated;
      }
      return r;
    }));
  };

  const handleSubmit = () => {
    const validReadings = readings.filter(r => r.currentReading > 0);
    alert(`Submitting ${validReadings.length} readings\nTotal consumption: ${validReadings.reduce((sum, r) => sum + r.consumption, 0)} gallons`);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const rows = text.split('\n').map(row => row.split('\t'));
    
    // Simple paste handling - would be more sophisticated in production
    alert('Paste detected! In production, this would parse and fill the grid.');
  };

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Bulk Reading Entry</h1>
        <p className="text-gray-600">
          Excel-like interface for entering multiple readings
        </p>
      </div>

      <div className="mb-4 flex justify-between items-center">
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
            📥 Import Excel
          </button>
          <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            📋 Paste from Clipboard
          </button>
        </div>
        <div className="text-sm text-gray-600">
          {readings.filter(r => r.currentReading > 0).length} of {readings.length} readings entered
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse" onPaste={handlePaste}>
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2 text-left">#</th>
              <th className="border p-2 text-left">Account</th>
              <th className="border p-2 text-left">Customer</th>
              <th className="border p-2 text-right">Previous</th>
              <th className="border p-2 text-right">Current</th>
              <th className="border p-2 text-right">Consumption</th>
              <th className="border p-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((reading, index) => (
              <tr key={reading.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="border p-2 text-gray-500">{index + 1}</td>
                <td className="border p-2 font-mono text-sm">{reading.account}</td>
                <td className="border p-2">{reading.customerName}</td>
                <td className="border p-2 text-right text-gray-600">{reading.previousReading}</td>
                <td className="border p-2">
                  <input
                    type="number"
                    value={reading.currentReading || ''}
                    onChange={(e) => updateReading(reading.id, 'currentReading', e.target.value)}
                    className="w-full px-2 py-1 border rounded text-right"
                    placeholder="0"
                  />
                </td>
                <td className="border p-2 text-right">
                  <span className={reading.consumption > 500 ? 'text-orange-600 font-medium' : ''}>
                    {reading.consumption > 0 ? reading.consumption : '-'}
                  </span>
                  {reading.consumption > 500 && ' ⚠️'}
                </td>
                <td className="border p-2">
                  <input
                    type="text"
                    value={reading.notes}
                    onChange={(e) => updateReading(reading.id, 'notes', e.target.value)}
                    className="w-full px-2 py-1 border rounded"
                    placeholder="Optional"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex justify-between items-center">
        <div className="text-sm text-gray-600">
          <p>💡 Tip: You can paste data from Excel directly into the grid</p>
          <p>⚠️ High consumption (>500) is highlighted</p>
        </div>
        <button
          onClick={handleSubmit}
          className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium"
        >
          Submit All Readings
        </button>
      </div>
    </div>
  );
}