'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { Dialog, Transition } from '@headlessui/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { User, Tenant } from '@/types/models'
import { Button } from '@/components/ui/button'

interface MobileNavProps {
  open: boolean
  onClose: () => void
  navigation: Array<{
    name: string
    href: string
    icon: React.ComponentType<{ className?: string }>
  }>
  pathname: string
  tenant: Tenant
  user: User
  onSignOut: () => void
}

export function MobileNav({
  open,
  onClose,
  navigation,
  pathname,
  tenant,
  user,
  onSignOut
}: MobileNavProps) {
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50 lg:hidden" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="transition-opacity ease-linear duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity ease-linear duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex">
          <Transition.Child
            as={Fragment}
            enter="transition ease-in-out duration-300 transform"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition ease-in-out duration-300 transform"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
              <Transition.Child
                as={Fragment}
                enter="ease-in-out duration-300"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="ease-in-out duration-300"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="text-foreground"
                  >
                    <X className="h-6 w-6" />
                  </Button>
                </div>
              </Transition.Child>

              <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-card px-6 pb-4">
                <div className="flex h-16 shrink-0 items-center">
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

                <nav className="flex flex-1 flex-col">
                  <ul role="list" className="flex flex-1 flex-col gap-y-7">
                    <li>
                      <ul role="list" className="-mx-2 space-y-1">
                        {navigation.map((item) => {
                          const isActive = pathname === item.href || 
                            (item.href !== '/admin' && pathname.startsWith(item.href))
                          
                          return (
                            <li key={item.name}>
                              <Link
                                href={item.href}
                                onClick={onClose}
                                className={cn(
                                  'flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6',
                                  isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                )}
                              >
                                <item.icon className="h-6 w-6 shrink-0" />
                                {item.name}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    </li>

                    <li className="mt-auto">
                      <div className="border-t pt-4">
                        <div className="mb-3 px-2">
                          <p className="text-sm font-medium text-foreground">
                            {user.full_name || user.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {user.role}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                          onClick={onSignOut}
                        >
                          Sign out
                        </Button>
                      </div>
                    </li>
                  </ul>
                </nav>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  )
}