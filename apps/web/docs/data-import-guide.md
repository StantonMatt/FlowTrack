# FlowTrack Data Import Guide

## Overview
FlowTrack supports importing customer and meter reading data from CSV and Excel files. This guide covers the import process, file formats, validation rules, and troubleshooting.

## Supported File Formats

- **CSV** (.csv) - Comma-separated values
- **Excel** (.xlsx, .xls) - Microsoft Excel workbooks
- **Text** (.txt) - Tab or comma delimited

## Customer Data Import

### Required Fields

| Field Name | Type | Description | Example |
|------------|------|-------------|---------|
| account_number | String | Unique customer account number | "ACC-001234" |
| first_name | String | Customer's first name | "John" |
| last_name | String | Customer's last name | "Doe" |
| email | String | Valid email address | "john.doe@example.com" |
| phone | String | Phone number (10+ digits) | "+1234567890" |
| service_address | String | Service location address | "123 Main St" |
| city | String | City name | "Springfield" |
| state | String | State/Province code | "CA" |
| postal_code | String | ZIP/Postal code | "90210" |
| meter_number | String | Meter identifier | "MTR-456789" |

### Optional Fields

| Field Name | Type | Description | Default |
|------------|------|-------------|---------|
| billing_address | String | Billing address (if different) | Same as service |
| status | String | Account status (active/inactive/suspended) | "active" |
| customer_type | String | residential/commercial/industrial | "residential" |
| rate_code | String | Billing rate code | Default rate |
| connection_date | Date | Service connection date | Current date |
| notes | String | Additional notes | Empty |

### CSV Format Example

```csv
account_number,first_name,last_name,email,phone,service_address,city,state,postal_code,meter_number
ACC-001234,John,Doe,john.doe@example.com,+1234567890,123 Main St,Springfield,CA,90210,MTR-456789
ACC-001235,Jane,Smith,jane.smith@example.com,+1234567891,456 Oak Ave,Springfield,CA,90211,MTR-456790
```

### Excel Format
- First row must contain column headers
- Data starts from row 2
- Each row represents one customer
- Empty rows are skipped

## Meter Reading Data Import

### Required Fields

| Field Name | Type | Description | Example |
|------------|------|-------------|---------|
| account_number | String | Customer account number | "ACC-001234" |
| meter_number | String | Meter identifier | "MTR-456789" |
| reading_date | Date | Date of reading | "2024-01-15" |
| reading_value | Number | Meter reading value | 12345.678 |

### Optional Fields

| Field Name | Type | Description | Default |
|------------|------|-------------|---------|
| reading_type | String | manual/automatic/estimated | "manual" |
| reader_id | String | ID of person/system taking reading | Current user |
| notes | String | Additional notes | Empty |
| photo_url | String | URL to meter photo | Empty |
| latitude | Number | GPS latitude | Empty |
| longitude | Number | GPS longitude | Empty |

### Date Format Support
- ISO 8601: `2024-01-15` or `2024-01-15T10:30:00`
- US Format: `01/15/2024` or `1/15/2024`
- European Format: `15/01/2024` or `15.01.2024`
- Excel serial dates are automatically converted

### CSV Format Example

```csv
account_number,meter_number,reading_date,reading_value,reading_type,notes
ACC-001234,MTR-456789,2024-01-15,12345.678,manual,Clear reading
ACC-001234,MTR-456789,2024-02-15,12789.123,manual,Normal consumption
ACC-001235,MTR-456790,2024-01-15,8765.432,automatic,Remote reading
```

## Import Process

### Step 1: Prepare Your Data
1. Export data from existing system
2. Clean and format according to requirements
3. Ensure required fields are present
4. Remove duplicate entries
5. Validate data formats

### Step 2: Upload File
1. Navigate to Settings > Data Import
2. Select import type (Customers or Readings)
3. Click "Choose File" or drag and drop
4. File size limit: 10MB

### Step 3: Field Mapping
1. System auto-detects column headers
2. Map your columns to FlowTrack fields
3. Required fields must be mapped
4. Optional fields can be skipped
5. Review sample data preview

### Step 4: Validation
1. System validates all rows
2. Shows validation summary:
   - Total rows
   - Valid rows
   - Invalid rows with reasons
3. Download validation report if needed
4. Fix errors and re-upload if necessary

### Step 5: Import Confirmation
1. Review import summary
2. Choose import options:
   - Skip duplicates
   - Update existing records
   - Create new only
3. Confirm import
4. Monitor progress bar

### Step 6: Post-Import
1. View import results
2. Download import report
3. Review imported data
4. Handle any partial failures

## Validation Rules

### Customer Validation
- **account_number**: Must be unique, 1-50 characters
- **email**: Valid email format (name@domain.com)
- **phone**: Minimum 10 digits, valid format
- **postal_code**: Valid format for country
- **state**: Valid state/province code
- **meter_number**: Must be unique if provided

### Reading Validation
- **account_number**: Must exist in system
- **meter_number**: Must match customer's meter
- **reading_date**: Valid date, not in future
- **reading_value**: Positive number, max 12 digits
- **consumption**: Auto-calculated, checked for anomalies

### Duplicate Detection
- Customers: Checked by account_number
- Readings: Checked by meter_number + reading_date
- Configurable behavior: skip, update, or error

## Bulk Import Best Practices

### Data Preparation
1. **Backup existing data** before import
2. **Test with small batch** (10-20 records)
3. **Use templates** provided in system
4. **Standardize formats** across all records
5. **Remove special characters** from text fields

### Performance Optimization
- **Batch large imports**: Split files >1000 rows
- **Import during off-hours** for large datasets
- **Disable auto-calculations** during import
- **Use CSV format** for fastest processing

### Data Quality
1. **Validate externally** using spreadsheet tools
2. **Check for duplicates** before import
3. **Ensure referential integrity** (customers before readings)
4. **Standardize naming** (uppercase, trim spaces)
5. **Handle missing data** explicitly

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Invalid date format" | Non-standard date format | Use YYYY-MM-DD format |
| "Customer not found" | Account doesn't exist | Import customers first |
| "Duplicate entry" | Record already exists | Skip or update existing |
| "Invalid email" | Malformed email address | Fix email format |
| "Required field missing" | Empty required column | Fill in missing data |
| "File too large" | >10MB file size | Split into smaller files |
| "Unsupported format" | Wrong file type | Convert to CSV/XLSX |

### Validation Report Fields
- Row number
- Field name
- Current value  
- Error description
- Suggested fix

### Recovery Options
1. **Partial import**: Import valid rows only
2. **Fix and retry**: Download errors, fix, re-import
3. **Manual entry**: Add failed records manually
4. **Rollback**: Undo entire import if needed

## Import Templates

Download templates from Settings > Data Import:
- `customer_import_template.csv`
- `reading_import_template.csv`
- `customer_import_template.xlsx`
- `reading_import_template.xlsx`

## Advanced Features

### Scheduled Imports
- Set up recurring imports via API
- SFTP/FTP integration available
- Email attachment processing
- Webhook notifications

### API Import Endpoint
```bash
POST /api/import/customers
POST /api/import/readings

Headers:
  Authorization: Bearer <token>
  Content-Type: multipart/form-data

Body:
  file: <file>
  options: {
    "skipDuplicates": true,
    "updateExisting": false,
    "validateOnly": false
  }
```

### Transformation Rules
- Auto-uppercase certain fields
- Phone number formatting
- Date standardization
- Meter reading rounding
- Unit conversion

## Audit Trail

All imports are logged with:
- Import date/time
- User who performed import
- File name and size
- Total rows processed
- Success/failure counts
- Validation errors
- Time taken

Access import history: Settings > Data Import > History

## Support

For assistance with data imports:
1. Check validation report for specific errors
2. Review this documentation
3. Use provided templates
4. Contact support with:
   - Import report
   - Sample data file
   - Error screenshots
   - Account details

## FAQs

**Q: Can I import historical readings?**
A: Yes, readings can be imported for any past date. Future dates are not allowed.

**Q: How do I update existing customer data?**
A: Use the same account_number and select "Update existing" option during import.

**Q: What happens to photos during import?**
A: Photo URLs are imported as references. Actual photos must be uploaded separately or linked to accessible URLs.

**Q: Can I undo an import?**
A: Imports can be rolled back within 24 hours from the History page.

**Q: Is there an import limit?**
A: Single file: 10MB or 50,000 rows. Daily limit: 500,000 rows total.

**Q: How are timezones handled?**
A: All dates/times are converted to the tenant's configured timezone.

**Q: Can I import custom fields?**
A: Yes, additional columns are stored in metadata/notes fields.