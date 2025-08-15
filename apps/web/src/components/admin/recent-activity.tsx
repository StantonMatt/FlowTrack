'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface RecentActivityProps {
  title: string
  items: any[]
  type: 'readings' | 'invoices'
}

export function RecentActivity({ title, items, type }: RecentActivityProps) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No recent activity</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {item.customer?.full_name || 'Unknown'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.customer?.account_number || 'N/A'}
                </p>
              </div>
              
              <div className="flex items-center gap-2">
                {type === 'readings' ? (
                  <>
                    <span className="text-sm font-medium">
                      {item.reading?.toLocaleString()} gal
                    </span>
                    <Badge variant={
                      item.status === 'confirmed' ? 'default' :
                      item.status === 'flagged' ? 'destructive' :
                      'secondary'
                    }>
                      {item.status}
                    </Badge>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium">
                      ${item.total_amount?.toFixed(2)}
                    </span>
                    <Badge variant={
                      item.status === 'paid' ? 'default' :
                      item.status === 'overdue' ? 'destructive' :
                      'secondary'
                    }>
                      {item.status}
                    </Badge>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}