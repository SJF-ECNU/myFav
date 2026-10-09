## ADDED Requirements
### Requirement: Independent persistent session
The application SHALL use a separate Douyin browser profile and SHALL NOT print cookie values.
#### Scenario: Interactive login
- **WHEN** the user runs the Douyin login command
- **THEN** a dedicated browser opens for manual login and saves its profile
#### Scenario: Session marker inspection
- **WHEN** the user runs the status command
- **THEN** the application reports only whether a session marker exists and does not claim favorite access is verified
