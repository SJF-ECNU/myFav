## ADDED Requirements
### Requirement: Synchronization starts content preparation
The service SHALL enqueue content preparation after successful synchronization without waiting for transcription completion.
#### Scenario: New favorite without subtitles
- **WHEN** synchronization discovers a video without available subtitles
- **THEN** background preparation starts local audio transcription before an Agent requests content
### Requirement: Prepared content survives restart
The service SHALL persist subtitles and video part metadata and reuse cached content without opening a browser.
#### Scenario: Reading cached text
- **WHEN** an Agent requests previously prepared content after restart
- **THEN** the service returns cached text and current item state
### Requirement: Preparation recovers on synchronization
The service SHALL reuse completed preparation and resume missing work during subsequent synchronization.
#### Scenario: Repeated synchronization
- **WHEN** the same favorites are synchronized again
- **THEN** available cached text is reused without duplicate transcription
