## ADDED Requirements
### Requirement: Independent platform scope
The service SHALL preserve existing Bilibili identities and isolate Douyin membership updates.
#### Scenario: Douyin synchronization
- **WHEN** Douyin myFav is successfully paginated
- **THEN** only Douyin membership changes and Bilibili results remain intact
### Requirement: Unified tools
The service SHALL support platform filters in sync and updates and route content by item identity.
#### Scenario: Reading Douyin content
- **WHEN** a client requests a Douyin item
- **THEN** its cached metadata and video text are returned with explicit evidence and platform
### Requirement: Scope-limited collection and prefetch
The service SHALL read only the configured collection and prepare its text after synchronization.
#### Scenario: Missing subtitles
- **WHEN** a collected video has no usable subtitle
- **THEN** original video audio is transcribed locally in the background
