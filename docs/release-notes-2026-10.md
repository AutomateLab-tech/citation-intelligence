# Citation Intelligence maintenance update

Surface provider failures instead of recording false zero-visibility reports.

Installation, compatibility, reproducible inputs and result limits are documented in [the maintenance guide](maintenance-guide.md). Snapshot products retain source and review dates separately from publication.

An incomplete visibility report now returns the provider error. A failed panel is not persisted as zero visibility. Five focused tests cover missing credentials, another provider failure, a valid zero-citation answer, a fully failed panel and selection of a successful engine.
