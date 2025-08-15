# FlowTrack Offline E2E Testing Checklist

## Prerequisites
- [ ] Chrome DevTools or similar browser developer tools available
- [ ] Test tenant account with sample data
- [ ] Mobile device or browser mobile emulation enabled
- [ ] Network throttling tools ready

## 1. PWA Installation & Setup

### Desktop
- [ ] Navigate to FlowTrack application
- [ ] Verify install prompt appears in address bar
- [ ] Click install and verify PWA installs successfully
- [ ] Launch PWA from desktop/start menu
- [ ] Verify app opens in standalone window

### Mobile
- [ ] Open FlowTrack in mobile browser
- [ ] Verify "Add to Home Screen" prompt appears
- [ ] Add to home screen
- [ ] Launch from home screen icon
- [ ] Verify app opens in fullscreen mode

## 2. Service Worker Registration

- [ ] Open DevTools > Application > Service Workers
- [ ] Verify service worker is registered and active
- [ ] Check "Update on reload" for testing
- [ ] Verify no errors in console
- [ ] Check service worker scope covers entire app

## 3. Offline Mode - Basic Functionality

### Initial Offline Test
- [ ] Load application while online
- [ ] Navigate to meter readings page
- [ ] Open DevTools > Network > Set to "Offline"
- [ ] Verify offline indicator appears in UI
- [ ] Try navigating between pages - should work
- [ ] Verify cached pages load correctly

### Cache Verification
- [ ] DevTools > Application > Cache Storage
- [ ] Verify precached assets are present
- [ ] Check runtime caches for API responses
- [ ] Verify static assets load from cache

## 4. Meter Reading Creation - Offline

### Create New Reading
- [ ] While offline, navigate to create reading form
- [ ] Fill in meter reading details:
  - [ ] Customer selection
  - [ ] Reading value
  - [ ] Reading date
  - [ ] Notes (optional)
- [ ] Submit form
- [ ] Verify success message appears
- [ ] Verify reading appears in list (from IndexedDB)

### Photo Capture - Offline
- [ ] Create new reading
- [ ] Click "Capture Photo" button
- [ ] Take or select photo
- [ ] Verify photo preview appears
- [ ] Submit reading with photo
- [ ] Verify reading saved with photo indicator

### Multiple Readings
- [ ] Create 5+ readings while offline
- [ ] Verify all appear in list
- [ ] Check different customers
- [ ] Add photos to some readings
- [ ] Verify queue count indicator shows correct number

## 5. IndexedDB Verification

- [ ] DevTools > Application > IndexedDB > FlowTrackOffline
- [ ] Check `readingsQueue` table:
  - [ ] Verify entries for offline readings
  - [ ] Check `synced: false` status
  - [ ] Verify idempotency keys present
- [ ] Check `photos` table:
  - [ ] Verify blob data for captured photos
  - [ ] Check photo references match readings

## 6. Background Sync - Queue Management

### Sync Registration
- [ ] DevTools > Application > Background Sync
- [ ] Verify 'sync-readings' tag registered
- [ ] Check retry attempts if sync fails

### Manual Sync Trigger
- [ ] While offline, create several readings
- [ ] Go back online (disable offline mode)
- [ ] Click manual sync button (if available)
- [ ] Monitor DevTools console for sync logs
- [ ] Verify sync progress indicator

## 7. Online Synchronization

### Automatic Sync
- [ ] Create 3-5 readings while offline
- [ ] Include at least one with photo
- [ ] Go back online
- [ ] Wait for automatic sync (or trigger manually)
- [ ] Monitor Network tab for API calls
- [ ] Verify all readings sync successfully

### Sync Verification
- [ ] Check Network tab for POST /api/readings calls
- [ ] Verify idempotency keys in headers
- [ ] Check photo uploads to Supabase Storage
- [ ] Verify IndexedDB entries marked as `synced: true`
- [ ] Confirm queue count returns to 0

### Server Verification
- [ ] Refresh page (forces fresh data load)
- [ ] Verify all offline-created readings appear
- [ ] Check reading details match
- [ ] Verify photos load from Supabase Storage
- [ ] Check no duplicate entries

## 8. Conflict Resolution

### Duplicate Prevention
- [ ] Create reading offline
- [ ] Sync to server
- [ ] Go offline again
- [ ] Try to sync same reading again (simulate retry)
- [ ] Verify no duplicate created (409 handling)

### Last-Write-Wins
- [ ] Create reading offline on Device A
- [ ] Create same reading offline on Device B
- [ ] Sync Device A first
- [ ] Sync Device B
- [ ] Verify latest timestamp wins
- [ ] Check no data loss

## 9. Error Handling

### Network Errors
- [ ] Simulate flaky connection (DevTools throttling)
- [ ] Create readings
- [ ] Verify retry with exponential backoff
- [ ] Check retry count increments
- [ ] Verify eventual success

### Auth Expiry
- [ ] Let auth token expire (wait or modify)
- [ ] Try to sync offline readings
- [ ] Verify token refresh triggered
- [ ] Confirm sync continues after refresh

### Server Errors
- [ ] Simulate 500 errors (backend or mock)
- [ ] Verify readings remain queued
- [ ] Check retry attempts
- [ ] Verify telemetry captures errors

## 10. Photo Handling

### Photo Sync
- [ ] Create reading with photo offline
- [ ] Go online and sync
- [ ] Verify photo uploads to Supabase Storage
- [ ] Check photo URL saved with reading
- [ ] Verify local photo blob deleted after sync

### Photo Compression
- [ ] Capture large photo (>5MB)
- [ ] Verify automatic compression
- [ ] Check compressed size <5MB
- [ ] Verify quality acceptable

### EXIF Stripping
- [ ] Take photo with location enabled
- [ ] Verify EXIF data removed
- [ ] Check no GPS coordinates in uploaded file

## 11. Telemetry & Monitoring

### Sync Telemetry
- [ ] Perform several sync operations
- [ ] Check DevTools console for telemetry logs
- [ ] Verify metrics captured:
  - [ ] Duration
  - [ ] Success/failure counts
  - [ ] Photo upload stats
  - [ ] Retry counts

### Error Reporting
- [ ] Force various errors (network, auth, etc.)
- [ ] Check error telemetry sent
- [ ] Verify error categorization
- [ ] Check Network tab for /api/telemetry calls

## 12. Performance Testing

### Large Dataset
- [ ] Create 50+ readings offline
- [ ] Include mix with/without photos
- [ ] Measure sync time
- [ ] Verify no UI freezing
- [ ] Check memory usage stays reasonable

### Slow Network
- [ ] Set network to "Slow 3G"
- [ ] Create readings with photos
- [ ] Verify sync completes eventually
- [ ] Check timeout handling
- [ ] Verify progress indicators work

## 13. Cross-Tab Synchronization

### BroadcastChannel
- [ ] Open app in multiple tabs
- [ ] Create reading in Tab 1 while offline
- [ ] Verify appears in Tab 2's list
- [ ] Sync in Tab 1
- [ ] Verify Tab 2 updates automatically

### Auth State Sync
- [ ] Login in Tab 1
- [ ] Verify Tab 2 gets auth state
- [ ] Logout in Tab 1
- [ ] Verify Tab 2 clears auth

## 14. PWA Update Flow

### Service Worker Update
- [ ] Deploy new version
- [ ] Refresh app
- [ ] Verify update prompt appears
- [ ] Click update
- [ ] Verify new version loads
- [ ] Check offline readings preserved

## 15. Data Cleanup

### Old Data Removal
- [ ] Check synced readings >7 days old
- [ ] Verify automatic cleanup runs
- [ ] Confirm photos removed from IndexedDB
- [ ] Verify queue entries cleaned

### Manual Cleanup
- [ ] Trigger manual cleanup
- [ ] Verify old data removed
- [ ] Check telemetry preserved
- [ ] Confirm current data intact

## 16. Edge Cases

### Offline-First Usage
- [ ] Use app entirely offline for a day
- [ ] Create 20+ readings
- [ ] Go online once
- [ ] Verify bulk sync works
- [ ] Check no data loss

### Intermittent Connection
- [ ] Toggle offline/online rapidly
- [ ] Create readings during transitions
- [ ] Verify no duplicate syncs
- [ ] Check all readings eventually sync

### Browser Limits
- [ ] Fill IndexedDB near quota
- [ ] Verify appropriate errors shown
- [ ] Check cleanup helps
- [ ] Verify app remains functional

## Sign-off

- [ ] All sections completed
- [ ] No critical issues found
- [ ] Performance acceptable
- [ ] User experience smooth
- [ ] Data integrity maintained

**Tested by:** _________________  
**Date:** _________________  
**Version:** _________________  
**Notes:** _________________