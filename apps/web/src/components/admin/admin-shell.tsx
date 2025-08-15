'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Home, 
  Users, 
  Gauge, 
  FileText, 
  CreditCard, 
  BarChart3, 
  Settings,
  Search,
  Menu,
  X,
  LogOut,
  User as UserIcon,
  ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { User, Tenant } from '@/types/models'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SearchModal } from './search-modal'
import { MobileNav } from './mobile-nav'

interface AdminShellProps {
  children: React.ReactNode
  user: User
  tenant: Tenant
}

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: Home },
  { name: 'Customers', href: '/admin/customers', icon: Users },
  { name: 'Readings', href: '/admin/readings', icon: Gauge },
  { name: 'Billing', href: '/admin/billing', icon: FileText },
  { name: 'Payments', href: '/admin/payments', icon: CreditCard },
  { name: 'Reports', href: '/admin/reports', icon: BarChart3 },
  { name: 'Settings', href: '/admin/settings', icon: Settings },
]

export function AdminShell({ children, user, tenant }: AdminShellProps) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar for desktop */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <div className="flex w-64 flex-col">
          <div className="flex flex-1 flex-col border-r bg-card">
            {/* Logo/Brand */}
            <div className="flex h-16 items-center px-6 border-b">
              {tenant.branding?.logo_url ? (
                <img 
                  src={tenant.branding.logo_url} 
                  alt={tenant.name}
                  className="h-8 w-auto"
                />
              ) : (
                <h1 className="text-xl font-bold text-foreground">
                  {tenant.name}
                </h1>
              )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 px-3 py-4">
              {navigation.map((item) => {
                const isActive = pathname === item.href || 
                  (item.href !== '/admin' && pathname.startsWith(item.href))
                
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                )
              })}
            </nav>

            {/* User section */}
            <div className="border-t p-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2">
                    <UserIcon className="h-4 w-4" />
                    <span className="flex-1 text-left text-sm">
                      {user.full_name || user.email}
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/admin/profile">
                      <UserIcon className="mr-2 h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/admin/settings">
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col">
        {/* Top header */}
        <header className="flex h-16 items-center gap-4 border-b bg-card px-6">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Search */}
          <div className="flex-1">
            <Button
              variant="outline"
              className="w-full max-w-md justify-start text-muted-foreground"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="mr-2 h-4 w-4" />
              Search customers...
              <kbd className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline">
                ⌘K
              </kbd>
            </Button>
          </div>

          {/* Desktop user menu */}
          <div className="hidden lg:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <UserIcon className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {user.full_name || user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin/profile">Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Mobile sidebar */}
      <MobileNav
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        navigation={navigation}
        pathname={pathname}
        tenant={tenant}
        user={user}
        onSignOut={handleSignOut}
      />

      {/* Search modal */}
      <SearchModal 
        open={searchOpen} 
        onClose={() => setSearchOpen(false)}
        tenantId={tenant.id}
      />
    </div>
  )
}