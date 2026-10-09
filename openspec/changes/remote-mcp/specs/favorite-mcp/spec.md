## ADDED Requirements
### Requirement: Authenticated MCP tools
The service SHALL expose sync_favorites, list_updates, get_content, set_processing_status, save_result and get_result through authenticated Streamable HTTP.
#### Scenario: Missing credentials
- **WHEN** a request lacks a valid bearer token
- **THEN** it is rejected before tool access
### Requirement: Durable updates
The service SHALL store successful selected-folder syncs transactionally and expose cursor-paginated added events without consuming another client's progress.
#### Scenario: Repeated sync
- **WHEN** the same members are synchronized repeatedly
- **THEN** no duplicate added events are created
#### Scenario: Failed sync
- **WHEN** browser synchronization fails
- **THEN** saved membership, cursors and results remain unchanged
### Requirement: Content evidence
The service SHALL expose selected member metadata and available per-part subtitles with explicit extraction status and SHALL never expose website credentials.
#### Scenario: Missing subtitles
- **WHEN** subtitles are absent or inaccessible
- **THEN** content reports that limitation without claiming complete video understanding
### Requirement: Durable result writeback
The service SHALL validate known item IDs and processing statuses and persist results across restart.
#### Scenario: Unknown item
- **WHEN** an agent writes a result for an unknown item ID
- **THEN** the service rejects the write

### Requirement: Audio fallback
The service SHALL start a local asynchronous audio transcription when per-part platform subtitles are unavailable, preserve timestamped text and expose pending or failed status.
#### Scenario: No subtitles
- **WHEN** a video part has no accessible platform subtitles
- **THEN** get_content returns transcription_pending and a later call returns persisted local Whisper text after completion
