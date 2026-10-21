---
name: resilient-systems-security
description: "Enforces 'Security is Job Zero' and long-term architectural resilience across the entire tech stack. Continuously assesses systems, evaluates end-to-end risks (database, API, client, auth, data tier, infrastructure), eliminates technical debt, and proactively designs defense-in-depth solutions before vulnerabilities manifest. Use when designing architectures, implementing full-stack features, auditing security posture, evaluating third-party integrations, reviewing code, or establishing hardened production configurations."
license: Apache-2.0
metadata:
  version: v1
  category: security
  tags:
    - security
    - resilience
    - defense-in-depth
    - architecture
    - data-protection
    - audit
---

# Resilient Systems Security & Defense-in-Depth

## Core Principle: Security is Job Zero

Security is not an afterthought, a final sprint review, or a cosmetic patch. **Security is Job Zero** — the non-negotiable foundation upon which every architecture, schema design, API contract, and UI component is built.

Short-term shortcuts compromise system integrity and accumulate compounding technical debt. Your mission as an agent is to act as the primary custodian of end-to-end security, data protection, and operational resilience across every layer of the technology stack.

---

## The Four Golden Directives

1. **Build for Long-Term Resilience, Not Temporary Relief**
   * Favor permanent, declarative, and self-enforcing solutions over manual interventions.
   * If a database table requires protection, do not just patch the table: install default privilege revocations (`ALTER DEFAULT PRIVILEGES`) and event triggers so future tables inherit security automatically.
   * If an API requires authorization, enforce it at the database and transactional service layer, not solely in UI route guards.

2. **Assume Breach and Practice Defense-in-Depth**
   * Never rely on a single defensive layer. Client validations fail or get bypassed; edge firewalls miss logical bugs; API gateways can be circumvented if backends expose ports or auto-generated services.
   * Enforce security at every boundary:
     * **Data Tier**: Explicit Row Level Security (RLS), least-privilege database roles, strict referential cascading.
     * **Service / API Tier**: Runtime schema validation (Zod), parameterized queries (Prisma/SQL), role-based and perspective-based authorization within atomic transactions.
     * **Transport Tier**: Strict TLS, Content Security Policy (CSP), anti-CSRF, and secure headers (`nosniff`, `DENY`, `HSTS`).
     * **Client Tier**: Zero secret leakage, minimal privilege in public bundles, `HttpOnly` / `SameSite` cookies.

3. **Continuously Question Assumptions & Hunt Toxic Combinations**
   * Analyze how third-party services and framework defaults interact.
   * *Example*: Pairing an ORM (Prisma) with a BaaS provider (Supabase) often leaves auto-generated PostgREST endpoints publicly queryable with the default `anon` key unless RLS and permissions are explicitly locked down. Always investigate what secondary services a provider deploys by default.

4. **Verify with Concrete Telemetry**
   * Ground every security assessment in verifiable evidence.
   * Never assume a port is closed, an endpoint is private, or a policy is active without running targeted, non-destructive verification probes (e.g. testing with unauthenticated headers or anon keys).

---

## End-to-End Security Architecture Checklist

### 1. Data Tier & Storage Layer
* [ ] **Row Level Security (RLS)**: Is RLS enabled on all application tables in public schemas?
* [ ] **Default Deny for Public Roles**: Are permissions explicitly revoked from unauthenticated roles (e.g. `anon`, `authenticated` in Supabase/PostgREST)?
* [ ] **Future Invariance**: Are default privileges altered (`ALTER DEFAULT PRIVILEGES REVOKE ALL ...`) or guarded by database event triggers so future migrations remain secure by default?
* [ ] **Strict Isolation & Scoping**: Do queries strictly filter by tenant/group/owner ID rather than trusting client-supplied identifiers?
* [ ] **Transactional Atomicity**: Are multi-step mutations (e.g. moving records, transferring balances, cascading deletions) wrapped in serializable transactions (`prisma.$transaction`) to prevent partial state corruption?
* [ ] **Document & Asset Storage**: Are cloud storage buckets (S3, GCS) private by default? Are pre-signed URLs time-limited with minimum required scopes?

### 2. API & Server Actions Layer
* [ ] **Runtime Input Validation**: Is every incoming argument strictly typed and validated using runtime schemas (e.g. Zod) before reaching business logic?
* [ ] **Zero Parameter Tampering**: Does the backend verify that the calling participant actually belongs to the target entity (e.g. verifying `groupId` match)?
* [ ] **Parameter Injection Immunity**: Are all database interactions parameterized via ORM/prepared statements to eliminate SQL injection?
* [ ] **Rate Limiting & Abuse Prevention**: Are computationally intensive or external third-party endpoints rate-limited?
* [ ] **Safe Error Boundaries**: Do error responses avoid leaking internal stack traces, database schema specifics, or environment details to the client?

### 3. Client & Identity Layer
* [ ] **Zero Secret Leakage**: Are all environment variables scrutinized? Ensure `NEXT_PUBLIC_*` or client-exposed variables only contain genuinely public tokens. Sensitive service keys (`SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, `DATABASE_URL`) must never touch client bundles.
* [ ] **Secure Storage**: Are sensitive session tokens kept out of unencrypted `localStorage` where XSS can extract them? Prefer `HttpOnly`, `SameSite=Lax/Strict`, `Secure` cookies.
* [ ] **Cross-Site Scripting (XSS) Prevention**: Does UI rendering avoid raw `dangerouslySetInnerHTML`? Are user-provided rich texts properly sanitized?
* [ ] **Cross-Origin & Embedding**: Are `X-Frame-Options: DENY` and `frame-ancestors: 'none'` enforced to prevent clickjacking?

### 4. CI/CD & Infrastructure Layer
* [ ] **Automated Migration Deployment**: Are migrations applied deterministically during automated builds (`prisma migrate deploy`) rather than via ad-hoc manual execution?
* [ ] **Lockfile Integrity**: Are dependency lockfiles committed and verified?
* [ ] **Least Privilege Deployment Credentials**: Are build and deployment tokens scoped strictly to their target environments?

---

## Operational Runbook: Executing a Security Review & Remediation

When asked to audit, secure, or remediate a system, follow this 5-stage procedure:

### Stage 1: Surface Discovery & Threat Modeling
1. Identify all database connections, public APIs, background crons, and third-party integrations.
2. List all exposed endpoints and external hostnames.
3. Map data sensitivity: Identify PII, financial balances, credentials, and user data.

### Stage 2: Empirical Verification & Risk Identification
1. Execute non-destructive verification probes:
   * Test REST/GraphQL endpoints with anon/unauthenticated headers.
   * Inspect HTTP response headers for missing security flags.
   * Check table RLS status and database role grants.
2. Formulate clear risk assessments: Define the vulnerability, attack vector, likelihood, and blast radius.

### Stage 3: Permanent, Resilient Solution Design
1. Design the fix to solve the root architectural cause, not just the symptom.
2. Ensure the solution is permanent: write a declarative migration, infrastructure-as-code, or configuration rule.
3. Validate that the remediation introduces zero regression to core application workflows.

### Stage 4: Implementation & Deployment
1. Apply changes via version-controlled code and migrations.
2. Commit with precise security rationale (`fix(security): ...`).
3. Deploy through established CI/CD pipelines.

### Stage 5: Verification & Regression Lockdown
1. Re-run verification probes to confirm unauthorized access is rejected (e.g. HTTP 403 / 42501).
2. Validate that legitimate application flows continue to operate seamlessly.
3. Establish regression guards (e.g. database triggers, CI linter checks).
