import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

export interface NotificationConfig {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  webhookEnabled: boolean;
  webhookUrl?: string;
}

export interface ReadingNotification {
  type: 'anomaly' | 'approval_required' | 'reading_complete' | 'route_assigned' | 'high_consumption';
  recipientId: string;
  recipientEmail: string;
  subject: string;
  message: string;
  data: Record<string, any>;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export class ReadingNotificationService {
  private supabase = createClient();

  /**
   * Send notification for anomaly detection
   */
  async notifyAnomaly(
    readingId: string,
    customerId: string,
    anomalyType: string,
    consumption: number
  ): Promise<void> {
    // Get reading and customer details
    const { data: reading } = await this.supabase
      .from('meter_readings')
      .select(`
        *,
        customers!inner (
          first_name,
          last_name,
          account_number,
          email
        )
      `)
      .eq('id', readingId)
      .single();

    if (!reading) return;

    // Get tenant admins and managers
    const { data: recipients } = await this.supabase
      .from('user_tenant_roles')
      .select('user_id, users!inner(email)')
      .eq('tenant_id', reading.tenant_id)
      .in('role', ['admin', 'manager']);

    if (!recipients || recipients.length === 0) return;

    // Create notification
    const notification: ReadingNotification = {
      type: 'anomaly',
      recipientId: '',
      recipientEmail: '',
      subject: `Anomaly Detected: ${anomalyType} consumption for ${reading.customers.first_name} ${reading.customers.last_name}`,
      message: `An anomaly has been detected in the meter reading for customer ${reading.customers.account_number}.
      
      Reading Date: ${format(new Date(reading.reading_date), 'MMM dd, yyyy')}
      Reading Value: ${reading.reading_value}
      Consumption: ${consumption} gallons
      Anomaly Type: ${anomalyType}
      
      Please review this reading for accuracy.`,
      data: {
        readingId,
        customerId,
        anomalyType,
        consumption,
        readingDate: reading.reading_date,
      },
      priority: anomalyType === 'negative' ? 'urgent' : 'high',
    };

    // Send to all recipients
    for (const recipient of recipients) {
      await this.sendNotification({
        ...notification,
        recipientId: recipient.user_id,
        recipientEmail: recipient.users.email,
      });
    }

    // Log notification
    await this.logNotification(reading.tenant_id, 'anomaly', notification);
  }

  /**
   * Send notification for approval required
   */
  async notifyApprovalRequired(
    readingId: string,
    reason: string
  ): Promise<void> {
    // Get reading details
    const { data: reading } = await this.supabase
      .from('meter_readings')
      .select(`
        *,
        customers!inner (
          first_name,
          last_name,
          account_number
        )
      `)
      .eq('id', readingId)
      .single();

    if (!reading) return;

    // Get approvers based on approval rules
    const { data: rules } = await this.supabase
      .from('reading_approval_rules')
      .select('notify_roles, notify_users')
      .eq('tenant_id', reading.tenant_id)
      .eq('is_active', true);

    const notifyRoles = new Set<string>();
    const notifyUsers = new Set<string>();

    rules?.forEach(rule => {
      rule.notify_roles?.forEach((role: string) => notifyRoles.add(role));
      rule.notify_users?.forEach((userId: string) => notifyUsers.add(userId));
    });

    // Get users by role
    const { data: roleUsers } = await this.supabase
      .from('user_tenant_roles')
      .select('user_id, users!inner(email)')
      .eq('tenant_id', reading.tenant_id)
      .in('role', Array.from(notifyRoles));

    // Get specific users
    const { data: specificUsers } = await this.supabase
      .from('users')
      .select('id, email')
      .in('id', Array.from(notifyUsers));

    const allRecipients = [
      ...(roleUsers || []).map(u => ({ user_id: u.user_id, email: u.users.email })),
      ...(specificUsers || []).map(u => ({ user_id: u.id, email: u.email })),
    ];

    // Create notification
    const notification: ReadingNotification = {
      type: 'approval_required',
      recipientId: '',
      recipientEmail: '',
      subject: `Approval Required: Reading for ${reading.customers.first_name} ${reading.customers.last_name}`,
      message: `A meter reading requires approval.
      
      Customer: ${reading.customers.account_number}
      Reading Date: ${format(new Date(reading.reading_date), 'MMM dd, yyyy')}
      Reading Value: ${reading.reading_value}
      Consumption: ${reading.consumption} gallons
      Reason: ${reason}
      
      Please review and approve or reject this reading.`,
      data: {
        readingId,
        customerId: reading.customer_id,
        reason,
      },
      priority: 'high',
    };

    // Send to all recipients
    for (const recipient of allRecipients) {
      await this.sendNotification({
        ...notification,
        recipientId: recipient.user_id,
        recipientEmail: recipient.email,
      });
    }

    // Log notification
    await this.logNotification(reading.tenant_id, 'approval_required', notification);
  }

  /**
   * Send notification for high consumption alert
   */
  async notifyHighConsumption(
    customerId: string,
    consumption: number,
    threshold: number,
    period: string
  ): Promise<void> {
    // Get customer details
    const { data: customer } = await this.supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (!customer || !customer.email) return;

    const notification: ReadingNotification = {
      type: 'high_consumption',
      recipientId: customerId,
      recipientEmail: customer.email,
      subject: 'High Water Consumption Alert',
      message: `Dear ${customer.first_name} ${customer.last_name},
      
      We've detected unusually high water consumption on your account.
      
      Account: ${customer.account_number}
      Period: ${period}
      Your Consumption: ${consumption.toFixed(2)} gallons
      Normal Range: Up to ${threshold.toFixed(2)} gallons
      
      This could indicate:
      - A water leak in your property
      - Increased usage due to irrigation or pool filling
      - A running toilet or faucet
      
      We recommend checking for leaks to avoid high water bills.
      
      If you have any questions, please contact our customer service.`,
      data: {
        customerId,
        consumption,
        threshold,
        period,
      },
      priority: 'medium',
    };

    await this.sendNotification(notification);

    // Also notify tenant admins
    await this.notifyTenantAdmins(
      customer.tenant_id,
      `High consumption alert for customer ${customer.account_number}`,
      notification.message
    );
  }

  /**
   * Send notification for route assignment
   */
  async notifyRouteAssignment(
    routeId: string,
    assignedTo: string,
    scheduledDate: Date
  ): Promise<void> {
    // Get route and user details
    const { data: route } = await this.supabase
      .from('reading_routes')
      .select('*')
      .eq('id', routeId)
      .single();

    const { data: user } = await this.supabase
      .from('users')
      .select('email')
      .eq('id', assignedTo)
      .single();

    if (!route || !user) return;

    const notification: ReadingNotification = {
      type: 'route_assigned',
      recipientId: assignedTo,
      recipientEmail: user.email,
      subject: `Reading Route Assigned: ${route.name}`,
      message: `You have been assigned a meter reading route.
      
      Route: ${route.name} (${route.route_code})
      Date: ${format(scheduledDate, 'EEEE, MMM dd, yyyy')}
      Total Customers: ${route.total_customers}
      Estimated Duration: ${route.estimated_duration_hours} hours
      
      Please review the route details and customer list before starting.`,
      data: {
        routeId,
        scheduledDate: scheduledDate.toISOString(),
      },
      priority: 'medium',
    };

    await this.sendNotification(notification);
    await this.logNotification(route.tenant_id, 'route_assigned', notification);
  }

  /**
   * Send batch notifications for upcoming readings
   */
  async notifyUpcomingReadings(
    tenantId: string,
    daysAhead: number = 3
  ): Promise<void> {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysAhead);

    // Get scheduled routes
    const { data: schedules } = await this.supabase
      .from('route_schedules')
      .select(`
        *,
        reading_routes!inner (
          name,
          route_code,
          assigned_to
        )
      `)
      .eq('scheduled_date', format(targetDate, 'yyyy-MM-dd'))
      .eq('status', 'scheduled');

    if (!schedules || schedules.length === 0) return;

    for (const schedule of schedules) {
      if (schedule.reading_routes.assigned_to) {
        await this.notifyRouteAssignment(
          schedule.route_id,
          schedule.reading_routes.assigned_to,
          targetDate
        );
      }
    }
  }

  /**
   * Core notification sender
   */
  private async sendNotification(notification: ReadingNotification): Promise<void> {
    try {
      // Check user notification preferences
      const config = await this.getNotificationConfig(notification.recipientId);

      // Send email notification
      if (config.emailEnabled && notification.recipientEmail) {
        await this.sendEmailNotification(notification);
      }

      // Send push notification (if implemented)
      if (config.pushEnabled) {
        await this.sendPushNotification(notification);
      }

      // Send webhook (if configured)
      if (config.webhookEnabled && config.webhookUrl) {
        await this.sendWebhookNotification(notification, config.webhookUrl);
      }

      // Store in-app notification
      await this.storeInAppNotification(notification);
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(notification: ReadingNotification): Promise<void> {
    // Use email service (e.g., Resend, SendGrid, etc.)
    const response = await fetch('/api/notifications/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: notification.recipientEmail,
        subject: notification.subject,
        message: notification.message,
        priority: notification.priority,
      }),
    });

    if (!response.ok) {
      console.error('Failed to send email notification');
    }
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(notification: ReadingNotification): Promise<void> {
    // Implement push notification logic (e.g., FCM, OneSignal)
    console.log('Push notification would be sent here:', notification);
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(
    notification: ReadingNotification,
    webhookUrl: string
  ): Promise<void> {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: notification.type,
          subject: notification.subject,
          message: notification.message,
          data: notification.data,
          priority: notification.priority,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.error('Webhook notification failed:', error);
    }
  }

  /**
   * Store in-app notification
   */
  private async storeInAppNotification(notification: ReadingNotification): Promise<void> {
    await this.supabase
      .from('notifications')
      .insert({
        user_id: notification.recipientId,
        type: notification.type,
        title: notification.subject,
        message: notification.message,
        data: notification.data,
        priority: notification.priority,
        is_read: false,
      });
  }

  /**
   * Get user notification configuration
   */
  private async getNotificationConfig(userId: string): Promise<NotificationConfig> {
    const { data } = await this.supabase
      .from('user_preferences')
      .select('notification_settings')
      .eq('user_id', userId)
      .single();

    return data?.notification_settings || {
      emailEnabled: true,
      smsEnabled: false,
      pushEnabled: true,
      webhookEnabled: false,
    };
  }

  /**
   * Notify tenant admins
   */
  private async notifyTenantAdmins(
    tenantId: string,
    subject: string,
    message: string
  ): Promise<void> {
    const { data: admins } = await this.supabase
      .from('user_tenant_roles')
      .select('user_id, users!inner(email)')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin');

    if (!admins) return;

    for (const admin of admins) {
      await this.sendNotification({
        type: 'high_consumption',
        recipientId: admin.user_id,
        recipientEmail: admin.users.email,
        subject,
        message,
        data: { tenantId },
        priority: 'low',
      });
    }
  }

  /**
   * Log notification for audit
   */
  private async logNotification(
    tenantId: string,
    type: string,
    notification: ReadingNotification
  ): Promise<void> {
    await this.supabase
      .from('notification_logs')
      .insert({
        tenant_id: tenantId,
        notification_type: type,
        recipient_id: notification.recipientId,
        subject: notification.subject,
        data: notification.data,
        sent_at: new Date().toISOString(),
      });
  }
}

// Export singleton instance
export const readingNotificationService = new ReadingNotificationService();