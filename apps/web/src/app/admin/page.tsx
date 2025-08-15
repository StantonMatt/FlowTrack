'use client';

import { useState } from 'react';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold">FlowTrack Admin</h1>
            <button className="text-sm text-gray-600 hover:text-gray-900">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {['overview', 'tenants', 'billing', 'users', 'settings'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-2 px-1 border-b-2 font-medium text-sm capitalize ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div>
            <h2 className="text-xl font-semibold mb-6">System Overview</h2>
            
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm text-gray-600">Total Tenants</div>
                <div className="text-3xl font-bold text-blue-600">12</div>
                <div className="text-xs text-gray-500 mt-1">+2 this month</div>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm text-gray-600">Active Users</div>
                <div className="text-3xl font-bold text-green-600">247</div>
                <div className="text-xs text-gray-500 mt-1">98% active rate</div>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm text-gray-600">Monthly Revenue</div>
                <div className="text-3xl font-bold text-purple-600">$45.2K</div>
                <div className="text-xs text-gray-500 mt-1">+12% vs last month</div>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm text-gray-600">Pending Invoices</div>
                <div className="text-3xl font-bold text-orange-600">38</div>
                <div className="text-xs text-gray-500 mt-1">$8,420 outstanding</div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-semibold mb-4">Recent Activity</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <div>
                    <div className="font-medium">New tenant onboarded</div>
                    <div className="text-sm text-gray-500">Springfield Water District</div>
                  </div>
                  <div className="text-sm text-gray-400">2 hours ago</div>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <div>
                    <div className="font-medium">Billing run completed</div>
                    <div className="text-sm text-gray-500">Generated 127 invoices</div>
                  </div>
                  <div className="text-sm text-gray-400">5 hours ago</div>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <div>
                    <div className="font-medium">System backup</div>
                    <div className="text-sm text-gray-500">Automated backup successful</div>
                  </div>
                  <div className="text-sm text-gray-400">1 day ago</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tenants Tab */}
        {activeTab === 'tenants' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">Tenant Management</h2>
              <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                + Add Tenant
              </button>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Tenant</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Subdomain</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Users</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr>
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium">Demo Water Company</div>
                        <div className="text-sm text-gray-500">Since Jan 2024</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">demo</td>
                    <td className="px-6 py-4 text-sm">23</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                        Active
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button className="text-blue-600 hover:text-blue-900 mr-3">Edit</button>
                      <button className="text-red-600 hover:text-red-900">Disable</button>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium">City Water Services</div>
                        <div className="text-sm text-gray-500">Since Mar 2024</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">citywater</td>
                    <td className="px-6 py-4 text-sm">45</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                        Active
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button className="text-blue-600 hover:text-blue-900 mr-3">Edit</button>
                      <button className="text-red-600 hover:text-red-900">Disable</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Billing Tab */}
        {activeTab === 'billing' && (
          <div>
            <h2 className="text-xl font-semibold mb-6">Billing Management</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Billing Runs */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold mb-4">Recent Billing Runs</h3>
                <div className="space-y-3">
                  <div className="border-b pb-3">
                    <div className="flex justify-between">
                      <span className="font-medium">January 2025</span>
                      <span className="text-green-600">✓ Complete</span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      247 invoices • $125,430 total
                    </div>
                  </div>
                  <div className="border-b pb-3">
                    <div className="flex justify-between">
                      <span className="font-medium">December 2024</span>
                      <span className="text-green-600">✓ Complete</span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      242 invoices • $118,920 total
                    </div>
                  </div>
                </div>
                <button className="mt-4 text-blue-600 hover:text-blue-900 text-sm">
                  View all runs →
                </button>
              </div>

              {/* Audit Reports */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold mb-4">Audit & Reports</h3>
                <div className="space-y-3">
                  <button className="w-full text-left px-4 py-3 bg-gray-50 rounded hover:bg-gray-100">
                    <div className="font-medium">Export Billing Summary</div>
                    <div className="text-sm text-gray-500">Download CSV report</div>
                  </button>
                  <button className="w-full text-left px-4 py-3 bg-gray-50 rounded hover:bg-gray-100">
                    <div className="font-medium">Reconciliation Report</div>
                    <div className="text-sm text-gray-500">Check for discrepancies</div>
                  </button>
                  <button className="w-full text-left px-4 py-3 bg-gray-50 rounded hover:bg-gray-100">
                    <div className="font-medium">Email Delivery Audit</div>
                    <div className="text-sm text-gray-500">Review failed deliveries</div>
                  </button>
                </div>
              </div>
            </div>

            {/* Anomalies Alert */}
            <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center">
                <span className="text-yellow-600 text-xl mr-3">⚠️</span>
                <div>
                  <div className="font-medium">3 Billing Anomalies Detected</div>
                  <div className="text-sm text-gray-600">2 missing PDFs, 1 unsent email</div>
                </div>
                <button className="ml-auto text-yellow-700 hover:text-yellow-900">
                  Review →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div>
            <h2 className="text-xl font-semibold mb-6">User Management</h2>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-gray-600">User management interface would go here...</p>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div>
            <h2 className="text-xl font-semibold mb-6">System Settings</h2>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-gray-600">System settings and configuration would go here...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}