## ADDED Requirements
### Requirement: Selected board membership
The service SHALL synchronize only the named board after verifying pagination and membership count.
#### Scenario: Complete board
- **WHEN** myFav board is loaded completely
- **THEN** its members are saved without changing other platforms
### Requirement: Prepared body and audio evidence
The service SHALL cache note body and locally transcribe original video audio without claiming visual understanding.
#### Scenario: Video without available subtitles
- **WHEN** video content is prepared
- **THEN** local audio transcription starts in the background and later reads return cached text
### Requirement: Private access parameters
The service SHALL keep site access links in server storage and SHALL NOT expose signed access parameters in MCP content.
#### Scenario: Client content read
- **WHEN** a client reads a note
- **THEN** the result includes body and evidence with a clean source URL
