'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Home } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

// Map of route segments to display names
const routeLabels: Record<string, string> = {
  admin: 'Dashboard',
  customers: 'Customers',
  readings: 'Meter Readings',
  billing: 'Billing',
  invoices: 'Invoices',
  payments: 'Payments',
  reports: 'Reports',
  settings: 'Settings',
  profile: 'Profile',
  new: 'New',
  edit: 'Edit',
}

interface BreadcrumbsProps {
  customLabels?: Record<string, string>
}

export function Breadcrumbs({ customLabels = {} }: BreadcrumbsProps) {
  const pathname = usePathname()

  // Parse pathname into segments
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .filter(segment => segment !== 'admin') // Remove 'admin' from breadcrumbs

  // Generate breadcrumb items
  const breadcrumbItems = segments.map((segment, index) => {
    const path = '/admin/' + segments.slice(0, index + 1).join('/')
    const isLast = index === segments.length - 1

    // Get label for segment
    let label = customLabels[segment] || routeLabels[segment] || segment

    // Handle UUID segments (likely entity IDs)
    if (segment.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      // This is a UUID, try to get a custom label or show a placeholder
      label = customLabels[segment] || 'Details'
    }

    // Capitalize first letter if no label found
    if (label === segment) {
      label = segment.charAt(0).toUpperCase() + segment.slice(1)
    }

    return {
      label,
      path,
      isLast,
    }
  })

  return (
    <Breadcrumb className="px-6 py-3 border-b">
      <BreadcrumbList>
        {/* Home/Dashboard link */}
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/admin" className="flex items-center gap-1">
              <Home className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {/* Dynamic breadcrumbs */}
        {breadcrumbItems.map((item, index) => (
          <Fragment key={item.path}>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              {item.isLast ? (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={item.path}>{item.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}