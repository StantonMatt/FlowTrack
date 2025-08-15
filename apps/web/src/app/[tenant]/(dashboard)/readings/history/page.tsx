'use client';

import { useState } from 'react';

interface PageProps {
  params: { tenant: string };
}

interface Reading {
  id: string;
  date: string;
  accountNumber: string;
  customerName: string;
  previousReading: number;
  currentReading: number;
  consumption: number;
  status: 'normal' | 'high' | 'low' | 'anomaly';
}

export default function ReadingHistoryPage({ params }: PageProps) {
  const [selectedCustomer, setSelectedCustomer] = useState<string>('all');
  const [dateRange, setDateRange] = useState('30days');

  // Mock data for testing
  const readings: Reading[] = [
    {
      id: '1',
      date: '2025-01-15',
      accountNumber: 'ACC-001',
      customerName: 'John Doe',
      previousReading: 11900,
      currentReading: 12000,
      consumption: 100,
      status: 'normal'
    },
    {
      id: '2',
      date: '2025-01-14',
      accountNumber: 'ACC-002',
      customerName: 'Jane Smith',
      previousReading: 11700,
      currentReading: 11800,
      consumption: 100,
      status: 'normal'
    },
    {
      id: '3',
      date: '2025-01-13',
      accountNumber: 'ACC-003',
      customerName: 'Bob Johnson',
      previousReading: 12000,
      currentReading: 12300,
      consumption: 300,
      status: 'high'
    },
    {
      id: '4',
      date: '2025-01-12',
      accountNumber: 'ACC-001',
      customerName: 'John Doe',
      previousReading: 11800,
      currentReading: 11900,
      consumption: 100,
      status: 'normal'
    },
    {
      id: '5',
      date: '2025-01-11',
      accountNumber: 'ACC-004',
      customerName: 'Alice Brown',
      previousReading: 11400,
      currentReading: 11500,
      consumption: 100,
      status: 'normal'
    },
    {
      id: '6',
      date: '2025-01-10',
      accountNumber: 'ACC-002',
      customerName: 'Jane Smith',
      previousReading: 11000,
      currentReading: 11700,
      consumption: 700,
      status: 'anomaly'
    }
  ];

  const filteredReadings = selectedCustomer === 'all' 
    ? readings 
    : readings.filter(r => r.accountNumber === selectedCustomer);

  // Calculate statistics
  const totalConsumption = filteredReadings.reduce((sum, r) => sum + r.consumption, 0);
  const avgConsumption = filteredReadings.length > 0 ? Math.round(totalConsumption / filteredReadings.length) : 0;
  const anomalyCount = filteredReadings.filter(r => r.status === 'anomaly').length;
  const highCount = filteredReadings.filter(r => r.status === 'high').length;

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Reading History</h1>
        <p className="text-gray-600">
          View and analyze meter reading data and consumption patterns
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-4">
        <select 
          value={selectedCustomer}
          onChange={(e) => setSelectedCustomer(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="all">All Customers</option>
          <option value="ACC-001">ACC-001 - John Doe</option>
          <option value="ACC-002">ACC-002 - Jane Smith</option>
          <option value="ACC-003">ACC-003 - Bob Johnson</option>
          <option value="ACC-004">ACC-004 - Alice Brown</option>
        </select>

        <select 
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="7days">Last 7 Days</option>
          <option value="30days">Last 30 Days</option>
          <option value="90days">Last 90 Days</option>
          <option value="365days">Last Year</option>
        </select>

        <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
          📊 Export Data
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">Total Readings</div>
          <div className="text-2xl font-bold">{filteredReadings.length}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">Total Consumption</div>
          <div className="text-2xl font-bold">{totalConsumption} gal</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">Avg Consumption</div>
          <div className="text-2xl font-bold">{avgConsumption} gal</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">Anomalies</div>
          <div className="text-2xl font-bold text-red-600">{anomalyCount}</div>
          {highCount > 0 && (
            <div className="text-sm text-orange-600">+{highCount} high usage</div>
          )}
        </div>
      </div>

      {/* Readings Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Account</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Customer</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Previous</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Current</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Consumption</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredReadings.map((reading) => (
              <tr key={reading.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm">{reading.date}</td>
                <td className="px-4 py-3 text-sm font-mono">{reading.accountNumber}</td>
                <td className="px-4 py-3 text-sm">{reading.customerName}</td>
                <td className="px-4 py-3 text-sm text-right">{reading.previousReading}</td>
                <td className="px-4 py-3 text-sm text-right">{reading.currentReading}</td>
                <td className="px-4 py-3 text-sm text-right font-medium">
                  {reading.consumption}
                </td>
                <td className="px-4 py-3 text-center">
                  {reading.status === 'normal' && (
                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                      Normal
                    </span>
                  )}
                  {reading.status === 'high' && (
                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800">
                      High ⚠️
                    </span>
                  )}
                  {reading.status === 'anomaly' && (
                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
                      Anomaly 🚨
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Consumption Chart Placeholder */}
      <div className="mt-6 bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">Consumption Trend</h3>
        <div className="h-64 bg-gray-100 rounded flex items-center justify-center text-gray-500">
          📊 Chart visualization would appear here
        </div>
      </div>
    </div>
  );
}