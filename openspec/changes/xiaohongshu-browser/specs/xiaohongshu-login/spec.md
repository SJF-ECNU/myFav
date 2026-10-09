## ADDED Requirements
### Requirement: Separate login profile
The application SHALL open a dedicated persistent Xiaohongshu browser for manual login without printing authentication values.
#### Scenario: Login preparation
- **WHEN** the user runs the login command
- **THEN** Xiaohongshu opens with a profile isolated from existing platforms
### Requirement: Scope preservation
The integration SHALL verify specified collection support before reading collected notes.
#### Scenario: No web collection support
- **WHEN** the website does not expose the requested collection
- **THEN** integration reports that limitation instead of collecting all favorites
