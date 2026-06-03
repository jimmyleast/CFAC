# UHP-OPS-Agent

Enterprise process orchestration platform with AI-powered coaching, real-time collaboration, and comprehensive documentation workflows.

## Features

- **Morgan Avatar Coaching**: Streaming video avatar with AI-powered process guidance using Claude 3.5 Sonnet
- **Process Management**: Create, design, and execute standard operating procedures (SOPs)
- **Collaborative Analysis**: RACI matrix, decision frameworks, system mappings, gap analysis
- **Real-time Export**: Generate professional DOCX documentation with one click
- **Squad Management**: Organize teams and manage access across processes
- **Responsive Design**: Mobile-first interface with Tailwind CSS and Next.js
- **Admin Dashboard**: Manage users, squads, and process templates

## Tech Stack

- **Frontend**: Next.js 14.2, React 18, TypeScript 6, Tailwind CSS
- **Backend**: Next.js API Routes with Supabase auth
- **AI Integration**: Anthropic Claude API for Morgan avatar intelligence
- **Real-time**: LiveKit (video/audio infrastructure), HeyGen (avatar streaming)
- **Database**: Supabase (PostgreSQL)
- **Email**: Resend for transactional emails
- **Testing**: Playwright E2E with comprehensive coverage

## Installation

### Prerequisites

- Node.js 18+
- npm or pnpm
- Supabase account and project
- Anthropic API key

### Setup

1. **Clone repository**
   ```bash
   git clone https://github.com/jimmyleast/UHP-OPS-Agent.git
   cd UHP-OPS-Agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   Create `.env.local`:
   ```env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_key

   # Anthropic
   ANTHROPIC_API_KEY=your_api_key

   # Email
   RESEND_API_KEY=your_resend_key

   # Site
   NEXT_PUBLIC_SITE_URL=http://localhost:3000

   # Optional: Test user credentials
   TEST_USER_EMAIL=test@uhp.com
   TEST_USER_PASSWORD=your_test_password
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) to start.

## Development

### Available Scripts

```bash
# Development
npm run dev          # Start dev server on port 3000
npm run build        # Production build
npm start            # Start production server

# Testing & Validation
npm run test:e2e     # Run all E2E tests
npm run test:e2e:smoke      # Smoke tests (basic sanity checks)
npm run test:e2e:contracts  # API contract validation
npm run test:e2e:auth       # Authenticated user workflows
npm run test:e2e:perf       # Performance & load testing
npm run test:e2e:validation # Accessibility & mobile compliance
npm run test:e2e:headed     # Interactive test mode

npm run verify:strict       # Lint + build + E2E (3x repeat for flake detection)
npm run verify:comprehensive # All test categories
npm run verify:ci           # CI/CD optimized verification

npm run test:e2e:report  # View test results and artifacts
npm run lint            # ESLint validation
```

## Testing

### E2E Test Suite

This project includes comprehensive E2E tests covering:

- **Smoke Tests**: Basic functionality and UX flows
- **Contract Tests**: API endpoint validation and auth guards
- **Authenticated Workflows**: Full user journeys (process creation, SOP editing, export)
- **Performance Tests**: Response time budgets and load testing
- **Validation Tests**: Accessibility (WCAG 2.1 AA), mobile responsiveness, schema validation

### Quick Test Commands

```bash
# Run all tests
npm run test:e2e

# Run specific test category
npm run test:e2e:smoke
npm run test:e2e:auth

# Interactive debugging
npm run test:e2e:headed

# View detailed results
npm run test:e2e:report

# Strict CI-like validation
npm run verify:strict
```

### Test Environment Setup

For authenticated tests, set environment variables:

```bash
export TEST_USER_EMAIL=test@uhp.com
export TEST_USER_PASSWORD=your_password
npm run test:e2e:auth
```

### Performance Budgets

- **Page loads**: 2-3.5 seconds
- **API responses**: 500ms-2 seconds
- **Concurrent requests**: < 5 seconds total
- **Mobile responsiveness**: iPhone 12, Galaxy S21, iPad Pro

See [tests/e2e/README.md](tests/e2e/README.md) for detailed test documentation.

## Architecture

### Project Structure

```
.
├── app/
│   ├── api/              # Next.js API routes
│   │   ├── auth/         # Authentication flows
│   │   ├── admin/        # Admin operations
│   │   ├── process/      # Process CRUD & operations
│   │   ├── chat/         # Morgan avatar chat
│   │   └── export/       # Document generation
│   ├── admin/            # Admin dashboard (protected)
│   ├── auth/             # Login/signup pages
│   └── process/          # Main app pages
├── components/
│   ├── agent/            # Morgan avatar & UI components
│   ├── auth/             # Authentication components
│   └── dashboard/        # Process listing & cards
├── lib/
│   ├── anthropic/        # Claude integration
│   ├── auth/             # Auth utilities
│   ├── supabase/         # Database client
│   └── export/           # Document generation
├── tests/e2e/            # Playwright test suite
└── supabase/             # Database migrations

```

### Key Components

- **MorganAvatar**: Streaming video avatar with autopilot coaching, response modes, and real-time guidance
- **ProcessPage**: Multi-tab SOP design interface with Command Center showing risk/action/ETA intelligence
- **AdminDashboard**: User and squad management with access control
- **ChatPanel**: Real-time conversation with Morgan providing contextual coaching

## Morgan Avatar Intelligence

The Morgan avatar uses a sophisticated coaching engine built on Claude 3.5 Sonnet:

- **Autopilot Mode**: Proactive coaching based on tab completion confidence
- **Response Depth**: Adjustable response modes (brief/standard/deep)
- **Command Center**: Risk analysis, next best actions, ETA to completion
- **Tab Scoring**: Live confidence metrics for SOP, RACI, decisions, systems, frameworks, and gap analysis
- **Context Awareness**: Process-specific guidance tailored to current phase and incomplete sections

## API Documentation

### Authentication Endpoints

- `POST /api/auth/setup-profile` - Complete user profile after signup
- `POST /api/auth/reset-password` - Send password reset email
- `POST /api/auth/magic-link` - Send magic link for passwordless auth

### Process Endpoints

- `GET /api/process` - List processes for current user
- `POST /api/process` - Create new process
- `GET /api/process/[id]` - Get process details
- `PATCH /api/process/[id]` - Update process
- `POST /api/process/[id]/duplicate` - Clone process

### Morgan Avatar

- `POST /api/morgan/token` - Get streaming token for avatar
- `GET /api/morgan/config` - Get avatar configuration

### Admin Endpoints

- `GET /api/admin/users` - List all users
- `POST /api/admin/invite` - Send squad invitations
- `GET /api/admin/squads` - List squads
- `PATCH /api/admin/squads/[id]` - Update squad

### Export

- `POST /api/export/[id]` - Generate DOCX documentation

All endpoints except auth routes require authentication (return 401 if unauthorized).

## Deployment

### Railway

The project is configured for Railway deployment via `railway.toml`:

```bash
# Deploy to Railway
railway up

# View logs
railway logs
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t uhp-ops-agent .
docker run -p 3000:3000 --env-file .env.local uhp-ops-agent
```

## Contributing

1. Create a feature branch: `git checkout -b feature/amazing-feature`
2. Make your changes with tests
3. Run verification: `npm run verify:comprehensive`
4. Commit: `git commit -am 'Add amazing feature'`
5. Push and create a Pull Request

## Quality Standards

- **Test Coverage**: Smoke, contract, auth, performance, and validation tests all passing
- **Linting**: ESLint with next/core-web-vitals config
- **Build**: Zero build errors, production bundle optimized
- **Performance**: 2-3.5s page loads, 500ms-2s API responses
- **Accessibility**: WCAG 2.1 AA compliant
- **Mobile**: Responsive on iPhone 12, Galaxy S21, iPad Pro

## Troubleshooting

### Tests Timing Out
- Ensure dev server running on port 3017: `npm run dev -- -p 3017`
- Or set `E2E_BASE_URL` to existing staging URL
- Increase timeout in `playwright.config.ts` if network is slow

### Auth Tests Failing
- Set `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` in `.env.local`
- Clear saved auth state: `rm tests/.auth/user.json`

### Morgan Avatar Not Loading
- Check Anthropic API key is valid
- Verify HeyGen credentials if using remote avatar
- Check browser console for WebRTC or network errors

### Build Errors
- Clear `.next` cache: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && npm install`

## Performance Metrics

Current baseline (local port 3017 isolated dev server):

| Metric | Target | Actual |
|--------|--------|--------|
| /auth/login load | 2s | ~1.2s |
| /process/[id] load | 3.5s | ~2.8s |
| /api/me response | 500ms | ~150ms |
| /api/process response | 1s | ~400ms |
| Concurrent 5 APIs | 5s | ~3.2s |
| Mobile responsive | ✓ | ✓ (iPhone, Galaxy, iPad) |
| WCAG 2.1 AA | ✓ | ✓ (a11y tests passing) |

## License

ISC

## Support

For issues and feature requests, open a GitHub issue or contact the development team.

---

**Last Updated**: March 2026  
**Version**: 1.0.0  
**Status**: Production Ready (E2E verified)