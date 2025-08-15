'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createCustomerSchema,
  updateCustomerSchema,
  type CreateCustomer,
  type UpdateCustomer,
  type Customer,
} from '@flowtrack/shared/schemas/customer';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { MapPin, CheckCircle, Loader2 } from 'lucide-react';

interface CustomerFormProps {
  customer?: Customer | null;
  open: boolean;
  onClose: () => void;
  onSuccess?: (customer: Customer) => void;
}

export function CustomerForm({
  customer,
  open,
  onClose,
  onSuccess,
}: CustomerFormProps) {
  const [loading, setLoading] = useState(false);
  const [addressValidated, setAddressValidated] = useState(false);
  const { toast } = useToast();
  
  const isEdit = !!customer;
  
  const form = useForm<CreateCustomer | UpdateCustomer>({
    resolver: zodResolver(isEdit ? updateCustomerSchema : createCustomerSchema),
    defaultValues: customer ? {
      id: customer.id,
      email: customer.email || '',
      full_name: customer.full_name,
      phone: customer.phone || '',
      status: customer.status,
      billing_address: customer.billing_address || {
        street: '',
        city: '',
        state: '',
        zip: '',
        country: 'US',
        verified: false,
      },
      service_address: customer.service_address || {
        street: '',
        city: '',
        state: '',
        zip: '',
        country: 'US',
        verified: false,
      },
      meter_id: customer.meter_id,
      meter_type: customer.meter_type,
      rate_plan: customer.rate_plan || '',
      metadata: customer.metadata || {},
    } : {
      email: '',
      full_name: '',
      phone: '',
      status: 'active',
      billing_address: {
        street: '',
        city: '',
        state: '',
        zip: '',
        country: 'US',
        verified: false,
      },
      service_address: {
        street: '',
        city: '',
        state: '',
        zip: '',
        country: 'US',
        verified: false,
      },
      meter_id: '',
      meter_type: 'water',
      rate_plan: '',
      metadata: {},
    },
  });

  const onSubmit = async (data: CreateCustomer | UpdateCustomer) => {
    setLoading(true);
    try {
      const url = isEdit ? `/api/customers/${customer.id}` : '/api/customers';
      const method = isEdit ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save customer');
      }

      toast({
        title: 'Success',
        description: `Customer ${isEdit ? 'updated' : 'created'} successfully`,
      });
      
      onSuccess?.(result.data);
      onClose();
      form.reset();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save customer',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const copyBillingToService = () => {
    const billingAddress = form.getValues('billing_address');
    form.setValue('service_address', { ...billingAddress });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Customer' : 'New Customer'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update customer information' : 'Add a new customer to the system'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Basic Information</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="full_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name *</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input type="tel" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Meter Information */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Meter Information</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="meter_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Meter ID *</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="meter_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Meter Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="water">Water</SelectItem>
                          <SelectItem value="electric">Electric</SelectItem>
                          <SelectItem value="gas">Gas</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="rate_plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate Plan</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., RESIDENTIAL-STANDARD" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Billing Address */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Billing Address</h3>
                {addressValidated && (
                  <Badge variant="secondary" className="text-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Validated
                  </Badge>
                )}
              </div>
              
              <FormField
                control={form.control}
                name="billing_address.street"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="billing_address.city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City *</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="billing_address.state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State *</FormLabel>
                      <FormControl>
                        <Input {...field} maxLength={2} placeholder="e.g., CA" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="billing_address.zip"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ZIP Code *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="12345" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Service Address */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Service Address</h3>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={copyBillingToService}
                >
                  Same as billing
                </Button>
              </div>
              
              <FormField
                control={form.control}
                name="service_address.street"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="service_address.city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City *</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="service_address.state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State *</FormLabel>
                      <FormControl>
                        <Input {...field} maxLength={2} placeholder="e.g., CA" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="service_address.zip"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ZIP Code *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="12345" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? 'Update' : 'Create'} Customer
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}