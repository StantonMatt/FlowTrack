# FlowTrack Import Guide

## Customer Data Import

FlowTrack supports bulk customer data import via CSV and Excel files. This guide covers the import process, data format requirements, and best practices.

## Supported File Formats

- **CSV** (.csv) - Comma-separated values
- **Excel** (.xlsx, .xls) - Microsoft Excel spreadsheets

## Customer Import Fields

### Required Fields

| Field Name | Description | Format | Example |
|------------|-------------|--------|---------|
| `first_name` | Customer's first name | Text (max 100 chars) | John |
| `last_name` | Customer's last name | Text (max 100 chars) | Doe |
| `email` | Email address | Valid email format | john.doe@example.com |
| `phone` | Phone number | 10+ digits | 555-555-5555 |
| `service_address` | Service location street | Text | 123 Main St |
| `city` | Service city | Text | Springfield |
| `state` | Service state | 2-letter code | IL |
| `postal_code` | ZIP code | 5 or 9 digits | 62701 |
| `meter_number` | Meter identifier | Text | MTR-001234 |

### Optional Fields

| Field Name | Description | Format | Default |
|------------|-------------|--------|---------|
| `account_number` | Customer account # | Text | Auto-generated |
| `billing_address` | Billing street address | Text | Same as service |
| `billing_city` | Billing city | Text | Same as service |
| `billing_state` | Billing state | 2-letter code | Same as service |
| `billing_postal_code` | Billing ZIP | 5 or 9 digits | Same as service |
| `status` | Account status | active/inactive/suspended | active |
| `customer_type` | Customer category | residential/commercial/industrial | residential |
| `rate_code` | Rate plan code | Text | Default rate |
| `connection_date` | Service start date | YYYY-MM-DD | Current date |
| `notes` | Additional notes | Text (max 500 chars) | Empty |

## CSV Template

Download our CSV template with all required fields:

```csv
first_name,last_name,email,phone,service_address,city,state,postal_code,meter_number,account_number,status,customer_type
John,Doe,john.doe@example.com,555-555-5555,123 Main St,Springfield,IL,62701,MTR-001234,,active,residential
Jane,Smith,jane.smith@example.com,555-555-5556,456 Oak Ave,Springfield,IL,62702,MTR-001235,,active,commercial
```

## Import Process

### Step 1: Prepare Your Data

1. Ensure all required fields are present
2. Validate email addresses are properly formatted
3. Check phone numbers have at least 10 digits
4. Verify state codes are 2-letter abbreviations
5. Remove any duplicate account numbers

### Step 2: Upload File

1. Navigate to **Customers** → **Import**
2. Click **Choose File** and select your CSV/Excel file
3. Review the field mapping preview
4. Select import options:
   - **Mode**: Create new, Update existing, or Upsert
   - **Duplicate Handling**: Skip, Update, or Error

### Step 3: Validate & Process

1. Click **Validate** to check for errors
2. Review validation report
3. Fix any errors in your source file if needed
4. Click **Start Import** to begin processing

### Step 4: Monitor Progress

- View real-time import progress
- Download error report if any rows fail
- Review successfully imported customers

## Data Validation Rules

### Email Validation
- Must contain @ symbol
- Valid domain format
- No spaces or special characters (except . _ - +)

### Phone Validation
- Minimum 10 digits
- Accepts formats: (555) 555-5555, 555-555-5555, 5555555555
- International format: +1-555-555-5555

### Address Validation
- Service address is validated against Google Maps API
- Standardized formatting applied automatically
- Invalid addresses flagged for review

### Account Number Rules
- If not provided, auto-generated using tenant-specific sequence
- Must be unique within tenant
- 10-digit format: TTTTSSSSSS (Tenant + Sequence)

## Error Handling

### Common Import Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Invalid email format" | Malformed email address | Check for typos, spaces, missing @ or domain |
| "Duplicate account number" | Account number already exists | Remove duplicate or use Update mode |
| "Missing required field" | Required column is empty | Fill in all required fields |
| "Invalid state code" | State not 2-letter code | Use standard state abbreviations (CA, NY, TX) |
| "Invalid phone number" | Less than 10 digits | Include area code |

### Error Report Format

Failed rows are exported with error details:

```csv
row_number,error_message,first_name,last_name,email,...
5,"Invalid email format",John,Doe,notanemail,...
12,"Duplicate account number",Jane,Smith,jane@example.com,...
```

## Best Practices

### Data Preparation
1. **Clean your data** - Remove extra spaces, fix formatting
2. **Validate offline** - Use Excel formulas to check data
3. **Start small** - Test with 10-20 records first
4. **Backup existing data** - Export current customers before large imports

### Performance Tips
- Files under 10MB process fastest
- Limit to 10,000 rows per import
- Use CSV format for best performance
- Import during off-peak hours for large datasets

### Security
- Remove sensitive data not needed for import
- Use secure connection (HTTPS)
- Delete local copies after successful import
- Review audit logs after import

## Meter Reading Import

### Reading Import Fields

| Field Name | Description | Format | Required |
|------------|-------------|--------|----------|
| `account_number` | Customer account | Text | Yes |
| `meter_number` | Meter ID | Text | Yes |
| `reading_date` | Date of reading | YYYY-MM-DD | Yes |
| `reading_value` | Meter reading | Number | Yes |
| `reading_type` | Type of reading | manual/automated/estimated | No |
| `notes` | Reading notes | Text | No |

### Reading CSV Template

```csv
account_number,meter_number,reading_date,reading_value,reading_type,notes
1234567890,MTR-001234,2024-01-15,12345,manual,Clear access
1234567891,MTR-001235,2024-01-15,23456,manual,Dog on premises
```

## API Integration

For programmatic imports, use our REST API:

### Upload Endpoint
```http
POST /api/customers/import
Content-Type: multipart/form-data

file: [CSV/Excel file]
options: {
  "mode": "create",
  "duplicateStrategy": "skip",
  "validateOnly": false
}
```

### Check Status
```http
GET /api/customers/import/{jobId}

Response:
{
  "id": "job-123",
  "status": "processing",
  "progress": 75,
  "total_rows": 1000,
  "processed_rows": 750,
  "successful_rows": 740,
  "failed_rows": 10
}
```

### Download Errors
```http
GET /api/customers/import/{jobId}/errors

Response: CSV file with error details
```

## Support

For import assistance:
- Check validation errors carefully
- Review this documentation
- Contact support with job ID for help
- Include sample data (without sensitive info) when reporting issues

## Changelog

- **v1.2** - Added support for bulk meter reading import
- **v1.1** - Excel format support added
- **v1.0** - Initial CSV import functionality