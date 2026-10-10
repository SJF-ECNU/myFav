## ADDED Requirements
### Requirement: Native Douyin page readiness
openDouyin SHALL wait for the native own-favorites response to succeed before exposing the browser to service API requests, rather than relying only on a visible tab label.

#### Scenario: DOM appears before native response
- **WHEN** the favorites tab is visible but the native response is pending
- **THEN** the service does not receive the page yet

#### Scenario: Native refusal
- **WHEN** the native favorites response returns403
- **THEN** the actual refusal propagates with page_initialization diagnostics and the session closes

#### Scenario: Missing native response
- **WHEN** the readiness response times out
- **THEN** opening fails without invoking subsequent service APIs or inventing an HTTP status
