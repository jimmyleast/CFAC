# E2E Testing Suite Documentation

This project includes a comprehensive E2E testing suite using Playwright covering authentication, performance, accessibility, and full user workflows.

## Test Categories

### 1. Smoke Tests (`smoke.spec.ts`)
Basic sanity checks for core functionality:
- Dashboard route redirects unauthenticated users to login
- Sign-up domain validation works correctly
- Forgot password validation functions
- API auth guards return 401 for unauthenticated requests

**Run**: `npm run test:e2e:smoke`

### 2. Contract Tests (`contracts.spec.ts`)
Validates API contracts and route guards:
- 19 protected API routes return 401 when unauthenticated
- 5 route guards properly redirect to login
- 3 public auth endpoints validate domains and formats

**Run**: `npm run test:e2e:contracts`

### 3. Authenticated Workflows (`authenticated.spec.ts`)
Full user journeys after login:
- Create new process from dashboard
- Update SOP document through workflow
- Export process documentation (DOCX/PDF)
- Navigate between tabs maintaining state
- Chat with Morgan avatar with conversation history

**Prerequisites**: Set `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` environment variables

**Run**: `npm run test:e2e:auth`

### 4. Performance Tests (`performance.spec.ts`)
Response time and load behavior validation:
- Page load time budgets (login: 2s, dashboard: 3s, process: 3.5s)
- API response time budgets (critical APIs: 500ms-1s, chat: 2s)
- Concurrent request handling (5 simultaneous requests < 5s)
- Resource loading efficiency
- Memory stability during interactions
- Payload size validation

**Run**: `npm run test:e2e:perf`

### 5. Validation Tests (`validation.spec.ts`)
Accessibility (WCAG 2.1 AA), mobile responsiveness, and schema validation:

**Accessibility Checks**:
- Semantic HTML structure
- Form labels associated with inputs
- Button accessible names
- Color contrast compliance
- Keyboard navigation
- Focus indicators

**Mobile Responsiveness**:
- Renders on iPhone 12 (390x844)
- Renders on Samsung Galaxy S21 (360x800)
- Renders on iPad Mini (768x1024)
- No horizontal scrolling required
- Touch targets ≥ 48x48px

**API Schema Validation**:
- Response structure validation
- Error response consistency
- Header validation
- Payload format validation

**Run**: `npm run test:e2e:validation`

## Quick Start

### Install Dependencies
```bash
npm install
```

### Setup Test Environment
Create `.env.local` or set environment variables:
```bash
# Optional: for authenticated tests
TEST_USER_EMAIL=test@uhp.com
TEST_USER_PASSWORD=your-test-password

# Optional: for CI/CD
E2E_BASE_URL=https://staging.example.com
```

### Run All Tests
```bash
npm run test:e2e
```

### Run Specific Test Category
```bash
npm run test:e2e:smoke      # Smoke tests only
npm run test:e2e:contracts  # Contract validation
npm run test:e2e:auth       # Authenticated workflows (requires TEST_USER_* env vars)
npm run test:e2e:perf       # Performance tests
npm run test:e2e:validation # Accessibility & compliance
```

### Run Tests by Device Type
```bash
npm run test:e2e:mobile   # Use only mobile projects (Pixel 5, iPhone 12)
npm run test:e2e:desktop  # Use only chromium desktop
```

### Run Tests in Headed Mode (Interactive)
```bash
npm run test:e2e:headed
```

### View Test Report
```bash
npm run test:e2e:report
```

## Verification Commands

### Strict Verification (Development)
Runs linting, build, and E2E tests with 3 repeats to detect test flakiness:
```bash
npm run verify:strict
```

### Comprehensive Verification (Full Suite)
Runs all test categories sequentially:
```bash
npm run verify:comprehensive
```

### CI/CD Verification
Optimized for continuous integration with JSON reporting:
```bash
npm run verify:ci
```

## Test Configuration

Tests run against isolated development server on port 3017 (unless `E2E_BASE_URL` is set).

### Device Coverage
- ✓ Chromium (desktop)
- ✓ Mobile Chrome (Pixel 5: 393x873)
- ✓ Mobile Safari (iPhone 12: 390x844)
- ✓ Tablet (iPad Pro: 1024x1366)

### Performance Budgets
- Page loads: 2-3.5 seconds
- API responses: 500ms-2 seconds
- Concurrent requests: < 5 seconds total
- Memory growth: < 5MB per interaction cycle

## Authentication in Tests

### Using Test Credentials
Set environment variables for authenticated test execution:
```bash
export TEST_USER_EMAIL=test@uhp.com
export TEST_USER_PASSWORD=password123
npm run test:e2e:auth
```

### Auth State Persistence
Auth state is automatically saved to `.auth/user.json` after successful login and reused in subsequent test runs.

To clear auth state:
```bash
rm tests/.auth/user.json
```

## Debugging Tests

### Run Single Test
```bash
npx playwright test -g "specific test name"
```

### Debug Mode (Step Through)
```bash
npx playwright test --debug
```

### Inspect Mode (Live Inspector)
```bash
npx playwright test --headed --debug
```

### View Traces/Videos
```bash
npm run test:e2e:report
```

## Test Artifacts

After test runs, artifacts are available in:
- `test-results/` - HTML reports, trace files, screenshots, videos
- `tests/.auth/` - Saved auth state

View report:
```bash
npm run test:e2e:report
```

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Install dependencies
  run: npm ci

- name: Run linting
  run: npm run lint

- name: Build application
  run: npm run build

- name: Run E2E tests
  run: npm run verify:ci

- name: Upload test results
  uses: actions/upload-artifact@v3
  if: always()
  with:
    name: playwright-report
    path: test-results/
    retention-days: 7
```

### Environment Variables for CI
```yaml
E2E_BASE_URL: ${{ secrets.STAGING_URL }}
TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
```

## Test Utilities

The test suite includes utilities for common tasks:

### Test Helpers
```typescript
import { TestHelpers, PerformanceMetrics, APIValidator, AccessibilityValidator } from './utils'

// Wait for network idle
await TestHelpers.waitForNetworkIdle(page, 5000)

// Generate test data
const processData = TestHelpers.generateProcessData()

// Check if element is in viewport
const visible = await TestHelpers.isInViewport(element)
```

### Performance Metrics
```typescript
// Collect performance metrics
const metrics = await PerformanceMetrics.collectMetrics(page)

// Analyze Web Vitals
const vitals = await PerformanceMetrics.analyzeWebVitals(page)
```

### API Validation
```typescript
// Validate response structure
const validation = APIValidator.validateResponseSchema(data, ['id', 'name', 'email'])

// Check security headers
const security = APIValidator.validateSecurityHeaders(response.headers())

// Validate payload size
const payloadCheck = APIValidator.validatePayloadSize(contentLength, 100)
```

### Accessibility
```typescript
// Check WCAG compliance
const a11y = await AccessibilityValidator.checkWCAGCompliance(page)
```

## Best Practices

1. **Use Page Fixtures**: Leverage `authenticatedPage` fixture for tests requiring auth
2. **Set Expectations Early**: Validate visible elements quickly, then interact
3. **Handle Race Conditions**: Use `waitForURL`, `waitForLoadState`, not hard delays
4. **Parallel Safety**: Tests should be independent and not share state
5. **Performance Budgets**: Keep response time expectations realistic for target environment
6. **Mobile Testing**: Test key user flows on actual mobile viewports
7. **Accessibility**: Include a11y checks in critical workflows

## Troubleshooting

### Tests Timeout
- Increase `timeout` in playwright.config.ts
- Check if dev server is running on port 3017
- Set `E2E_BASE_URL` to external URL if needed

### Auth Tests Failing
- Verify `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` are set
- Check auth state file permissions in `.auth/`
- Clear auth state: `rm tests/.auth/user.json`

### Flaky Performance Tests
- Environment may be slow; adjust budgets or use `--repeat-each=3` for validation
- Network requests may vary; use reasonable thresholds
- Run on consistent hardware; CI should use Docker for reproducibility

### Mobile Tests Failing
- Check viewport size matches device specifications
- Verify touch interactions work with current event configuration
- Use `--headed` to visually inspect mobile rendering

## Performance Targets

### Page Load Times
| Route | Budget | Notes |
|-------|--------|-------|
| /auth/login | 2s | Minimal JS, should be fast |
| / (dashboard) | 3s | May load data |
| /process/[id] | 3.5s | Complex component, SOP data |
| /admin | 3s | Protected, should be fast |

### API Response Times
| Endpoint | Budget | Notes |
|----------|--------|-------|
| /api/me | 500ms | Critical auth check |
| /api/process | 1s | List with pagination |
| /api/chat | 2s | May involve AI inference |
| /api/export | 3s | Document generation |

## Contributing

When adding new tests:

1. Place in appropriate spec file based on category
2. Use descriptive test names
3. Add retry logic for flaky async operations
4. Document any prerequisites (auth, env vars)
5. Include both happy path and error cases
6. Keep performance budgets reasonable
7. Test on multiple device sizes for UX tests

## References

- [Playwright Documentation](https://playwright.dev)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Web Vitals](https://web.dev/vitals/)
- [Testing Best Practices](https://playwright.dev/docs/testing-library)
