# FlowTrack Offline E2E Testing Checklist

## Overview
This document provides a comprehensive checklist for manually testing the offline functionality of FlowTrack. Follow these steps to ensure all offline features work correctly.

## Prerequisites
- [ ] Chrome/Edge DevTools open (F12)
- [ ] Application running locally or on staging
- [ ] Test user account with appropriate permissions
- [ ] Test customer data available
- [ ] Mobile device or browser mobile emulation enabled

## Testing Environment Setup

### 1. Service Worker Installation
- [ ] Navigate to the application
- [ ] Open DevTools → Application → Service Workers
- [ ] Verify service worker is installed and activated
- [ ] Check "Update on reload" for testing
- [ ] Verify service worker scope covers entire application

### 2. IndexedDB Setup
- [ ] Open DevTools → Application → IndexedDB
- [ ] Verify `FlowTrackOffline` database exists
- [ ] Check for tables: `readingsQueue`, `photos`, `pendingPhotos`
- [ ] Verify initial schema version (should be 4)

## Offline Functionality Tests

### 3. Basic Offline Mode
- [ ] Load application while online
- [ ] Navigate to Network tab → Set to "Offline"
- [ ] Verify offline indicator appears in UI
- [ ] Navigate between pages - should work without errors
- [ ] Verify cached assets load correctly

### 4. Reading Capture While Offline

#### 4.1 Manual Reading Entry
- [ ] Go offline (Network → Offline)
- [ ] Navigate to Readings → New Reading
- [ ] Fill in reading form:
  - [ ] Select customer
  - [ ] Enter reading value
  - [ ] Select reading date
  - [ ] Add notes (optional)
- [ ] Submit reading
- [ ] Verify success message appears
- [ ] Check IndexedDB → readingsQueue for new entry
- [ ] Verify entry has:
  - [ ] Unique clientId
  - [ ] idempotencyKey
  - [ ] synced: false
  - [ ] syncAttempts: 0

#### 4.2 Photo Capture
- [ ] While still offline, create new reading
- [ ] Click "Camera" or "Upload" button
- [ ] Select/capture photo
- [ ] Verify photo preview appears
- [ ] Verify "Saved offline" indicator
- [ ] Submit reading with photo
- [ ] Check IndexedDB:
  - [ ] photos table has blob entry
  - [ ] pendingPhotos has upload record
  - [ ] readingsQueue references photoId

### 5. Background Sync

#### 5.1 Automatic Sync
- [ ] Create 3-5 readings while offline
- [ ] Go back online (Network → No throttling)
- [ ] Wait for background sync (should trigger within 30 seconds)
- [ ] Monitor Network tab for sync requests
- [ ] Verify requests include:
  - [ ] Idempotency-Key header
  - [ ] Authorization header
  - [ ] Correct tenant ID
- [ ] Check IndexedDB:
  - [ ] Synced readings marked as synced: true
  - [ ] serverId populated
  - [ ] syncError: null

#### 5.2 Manual Sync Trigger
- [ ] Create readings while offline
- [ ] Go online
- [ ] Click "Sync Now" button (if available)
- [ ] Verify immediate sync attempt
- [ ] Check console for sync logs

#### 5.3 Photo Upload During Sync
- [ ] Create reading with photo while offline
- [ ] Go online and trigger sync
- [ ] Monitor Network tab for:
  - [ ] Storage upload request to Supabase
  - [ ] Reading sync with photo_url
- [ ] Verify photo removed from pendingPhotos after upload

### 6. Error Handling

#### 6.1 Network Failures
- [ ] Create readings offline
- [ ] Go online
- [ ] Use Network → Custom → Add pattern to block API
- [ ] Verify sync attempts
- [ ] Check exponential backoff:
  - [ ] First retry: ~5 seconds
  - [ ] Second retry: ~10 seconds
  - [ ] Third retry: ~20 seconds
- [ ] Check IndexedDB for incrementing syncAttempts

#### 6.2 Server Errors
- [ ] Simulate 500 error (use Network → Response override)
- [ ] Verify reading stays in queue
- [ ] Verify retry attempts
- [ ] Check syncError field updated

#### 6.3 Authentication Errors
- [ ] Expire session token
- [ ] Attempt sync
- [ ] Verify 401 handling
- [ ] Verify user prompted to re-authenticate

### 7. Data Persistence

#### 7.1 Page Refresh
- [ ] Create readings offline
- [ ] Refresh page (F5)
- [ ] Verify readings still in queue
- [ ] Verify photos still accessible

#### 7.2 Browser Restart
- [ ] Create readings offline
- [ ] Close browser completely
- [ ] Reopen and navigate to app
- [ ] Verify data persists
- [ ] Go online and verify sync

### 8. Queue Management

#### 8.1 Queue Statistics
- [ ] Create multiple readings offline
- [ ] Check queue statistics display:
  - [ ] Total pending count
  - [ ] Oldest entry timestamp
  - [ ] Last sync attempt time

#### 8.2 Clear Queue (Admin)
- [ ] Verify clear queue function (if exposed)
- [ ] Confirm warning dialog
- [ ] Verify all entries removed from IndexedDB

### 9. Performance Tests

#### 9.1 Large Queue
- [ ] Create 50+ readings offline
- [ ] Verify UI remains responsive
- [ ] Go online
- [ ] Verify batch sync works
- [ ] Monitor memory usage in Performance tab

#### 9.2 Large Photos
- [ ] Capture high-resolution photos (3-5MB each)
- [ ] Verify compression/resizing if implemented
- [ ] Check storage limits
- [ ] Verify upload performance

### 10. Edge Cases

#### 10.1 Duplicate Prevention
- [ ] Create reading for customer/date offline
- [ ] Try to create duplicate
- [ ] Verify duplicate detection/warning

#### 10.2 Concurrent Edits
- [ ] Create reading offline on Device A
- [ ] Create different reading online on Device B
- [ ] Sync Device A
- [ ] Verify no conflicts

#### 10.3 Storage Quota
- [ ] Fill IndexedDB near quota (Chrome DevTools → Application → Clear storage → Show)
- [ ] Attempt to create new readings
- [ ] Verify graceful handling
- [ ] Check cleanup of old synced data

### 11. PWA Features

#### 11.1 Install Prompt
- [ ] Verify install prompt appears (desktop/mobile)
- [ ] Install PWA
- [ ] Launch from home screen/desktop
- [ ] Verify offline functionality in standalone mode

#### 11.2 Update Flow
- [ ] Deploy new version
- [ ] Verify update prompt
- [ ] Accept update
- [ ] Verify new service worker activates
- [ ] Check data migration if schema changed

### 12. Telemetry & Monitoring

#### 12.1 Sync Metrics
- [ ] Check telemetry endpoint calls
- [ ] Verify metrics include:
  - [ ] Sync success/failure counts
  - [ ] Sync duration
  - [ ] Queue sizes
  - [ ] Retry counts

#### 12.2 Error Reporting
- [ ] Trigger various errors
- [ ] Verify error logging
- [ ] Check error details include context

## Mobile-Specific Tests

### 13. Mobile Browser

#### 13.1 iOS Safari
- [ ] Test on actual iOS device
- [ ] Verify service worker support (iOS 11.3+)
- [ ] Test home screen installation
- [ ] Verify offline functionality

#### 13.2 Android Chrome
- [ ] Test on actual Android device  
- [ ] Verify camera access
- [ ] Test background sync
- [ ] Verify push notifications (if implemented)

### 14. Network Conditions

#### 14.1 Slow 3G
- [ ] Set Network → Slow 3G
- [ ] Create readings with photos
- [ ] Verify timeout handling
- [ ] Check retry logic

#### 14.2 Intermittent Connection
- [ ] Rapidly toggle online/offline
- [ ] Verify no data loss
- [ ] Check sync queue integrity

## Cleanup

### 15. Post-Test Cleanup
- [ ] Clear test data from IndexedDB
- [ ] Unregister service worker if needed
- [ ] Clear browser cache
- [ ] Document any issues found

## Test Results

### Summary
- Date Tested: _____________
- Tester: _____________
- Version: _____________
- Browser: _____________
- Device: _____________

### Issues Found
1. _____________
2. _____________
3. _____________

### Notes
_____________

## Automated Test Coverage
For areas covered by automated tests, see:
- `/src/lib/pwa/__tests__/sync-queue.test.ts`
- `/src/lib/db/__tests__/offline.test.ts`
- `/src/lib/readings/__tests__/offline-queue.test.ts`

## Troubleshooting

### Common Issues

1. **Service Worker Not Installing**
   - Check HTTPS (or localhost)
   - Clear cache and hard reload
   - Check console for errors

2. **IndexedDB Not Working**
   - Check browser support
   - Verify not in private/incognito mode
   - Check storage quota

3. **Background Sync Not Triggering**
   - Verify browser support
   - Check service worker is active
   - Try manual trigger

4. **Photos Not Uploading**
   - Check Supabase Storage bucket exists
   - Verify RLS policies
   - Check file size limits

5. **Queue Not Clearing**
   - Check server responses (should be 2xx)
   - Verify idempotency working
   - Check for JavaScript errors

## Browser Compatibility Matrix

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Service Worker | ✅ 45+ | ✅ 44+ | ✅ 11.3+ | ✅ 17+ |
| Background Sync | ✅ 49+ | ❌ | ❌ | ✅ 79+ |
| IndexedDB | ✅ 24+ | ✅ 16+ | ✅ 10+ | ✅ 12+ |
| PWA Install | ✅ 73+ | ✅ Android | ✅ iOS 11.3+ | ✅ 79+ |

## Contact
For issues or questions about offline testing:
- Development Team: dev@flowtrack.com
- QA Team: qa@flowtrack.com