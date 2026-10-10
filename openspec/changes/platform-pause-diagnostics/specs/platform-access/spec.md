## ADDED Requirements
### Requirement: Sanitized pause diagnostics
The service SHALL record pause time, actual HTTP status when available, fixed request stage and signal without URLs, credentials or response text. It SHALL retain bounded history after manual recovery and return diagnostic context to MCP callers.

#### Scenario: HTTP refusal
- **WHEN** an image download returns HTTP 403
- **THEN** its pause records image_download, HTTP 403 and trigger time without the signed URL

#### Scenario: Local session check
- **WHEN** a session or account check fails without an HTTP response
- **THEN** HTTP status is unknown and the corresponding local stage is recorded
