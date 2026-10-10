## ADDED Requirements
### Requirement: Persistent platform refusal handling
The service SHALL stop subsequent platform work after explicit denial or authentication failure and SHALL persist rate-limit cooldowns.
#### Scenario: Platform denies access
- **WHEN** a platform returns HTTP 403 or 412, an authentication failure, or an explicit verification challenge
- **THEN** browser and media work for that platform remain paused until an operator resumes it, including after restart
#### Scenario: Rate limit
- **WHEN** a platform returns HTTP 429
- **THEN** work is suppressed for at least 15 minutes and honors a longer valid Retry-After
### Requirement: Current collection scope and cache deletion
The service SHALL check membership before queued work and cache writes and SHALL retain fetched caches for seven days after a successful snapshot removes an item and SHALL delete expired caches during startup, synchronization and hourly local cleanup. Repeated absent snapshots SHALL NOT extend retention.
#### Scenario: Removal while work is pending
- **WHEN** a successful sync removes an item before queued lookup or cache write
- **THEN** queued lookup is skipped and late results are not persisted
#### Scenario: Re-add
- **WHEN** an item is removed and later re-added
- **THEN** complete cached media sources, images, content and transcripts are restored within seven days; expired caches are not reused, and old unfinished tasks cannot write into the re-added item
