## ADDED Requirements

### Requirement: Persistent browser login
The system SHALL use an isolated persistent browser profile and allow manual website login without exposing credentials.

#### Scenario: Restart
- **WHEN** a valid logged-in profile is reopened
- **THEN** the system checks the current account without asking for credentials again

### Requirement: Complete favorites read
The system SHALL enumerate the current user's created video favorite folders and all pages before replacing the saved result.

#### Scenario: Multiple pages
- **WHEN** a folder contains more than one page
- **THEN** all member-ID pages are read and membership is checked for duplicates and folder count consistency

#### Scenario: Failed read
- **WHEN** authentication, HTTP, JSON, permissions or pagination validation fails
- **THEN** sync reports failure and leaves the previous saved result unchanged

### Requirement: Missing details preserve membership
The system SHALL retain known member IDs when the details API omits a resource, without assuming it was removed from favorites.

#### Scenario: One resource has no details
- **WHEN** the authenticated IDs endpoint includes a resource but the details endpoint omits it
- **THEN** the saved result retains its ID and type with metadataStatus missing and does not claim it is deleted

### Requirement: Named folder scope
The CLI SHALL default to the exact folder name myFav and SHALL accept another explicit folder name. It SHALL only request member IDs and details from that selected folder.

#### Scenario: Selected folder
- **WHEN** multiple favorite folders exist and one matches the requested name
- **THEN** only that folder's resources are read and saved

#### Scenario: Missing or duplicate name
- **WHEN** the requested folder is absent or ambiguous
- **THEN** sync fails without reading any folder contents or replacing saved results
