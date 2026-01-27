# Memory: architecture/public-landing-and-multi-tenant-routing
Updated: just now

The application implements a strict multi-tenant routing architecture with a public landing page. Route structure: "/" (PublicLandingPage - no auth required), "/auth/*" (authentication), "/app/*" (tenant application with TenantRouteGuard requiring org membership), "/platform/*" (platform admin with PlatformRouteGuard). Both guards use deterministic state machines to prevent infinite loading. TenantRouteGuard auto-selects single org or shows OrganizationPickerModal for multiple memberships. Unauthenticated users hitting /app/* or /platform/* redirect to /auth/login. This enforces strict tenant isolation while providing clear user pathways.
