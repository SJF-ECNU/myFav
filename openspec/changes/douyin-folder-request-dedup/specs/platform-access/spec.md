## ADDED Requirements
### Requirement: Nonredundant Douyin sync verification
Douyin synchronization SHALL verify the selected folder owner inside collection without issuing a duplicate pre-sync folder query. Detail preparation SHALL retain its owner check.

#### Scenario: Bound folder sync
- **WHEN** the bound collection is synchronized
- **THEN** collection validates owner, name, membership and final count with no duplicate pre-sync query

### Requirement: Separate Douyin endpoint diagnostics
The service SHALL distinguish folder list refusals from member list refusals without recording raw URLs.

#### Scenario: Folder refusal
- **WHEN** collects/list returns 403
- **THEN** diagnostics label favorites_folders

#### Scenario: Member refusal
- **WHEN** collects/video/list returns 403
- **THEN** diagnostics label favorites_members
