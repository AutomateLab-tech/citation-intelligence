# Citation Intelligence maintenance guide

Use a fixed query set and record the engine and observation time. A missing citation in one response is not proof that a page is absent from an engine. Keep recorded responses separate from new observations.

## Installation and compatibility

Follow the repository README for the supported install method and runtime. Pin the version used in a reproducible example. Keep credentials in your client configuration, outside shared fixtures.

## Verified tool surface

The local compiled server returned these names through MCP `tools/list` on 12 October 2026. Recheck after upgrading.

- `citations_check`
- `domain_am_i_cited`
- `signals_ai_overview`
- `domain_cited_for`
- `citations_predict`
- `panel_track`
- `panel_run`
- `report_visibility`
- `citations_trend`
- `competitors_compare`
- `signals_wikipedia`
- `audit_sitemap`
- `competitors_compete`
- `citations_freshness`
- `domain_cited_for_diff`
- `signals_gsc_gap`
- `signals_bing_gap`
- `audit_schema`
- `audit_llms_txt`
- `signals_answer_box`
- `citations_provenance`
- `citations_evidence`
- `audit_crawler_access`
- `audit_sitemap_map`
- `competitors_canonical_set`
- `audit_structured_data`

## First call

Start with `report_visibility`. Required fields: `domain`. Read its input schema before passing a recorded fixture.

## Verify a change

Record the package or snapshot version, exact input, observation time and actual output. Check a materially different input and a valid neighboring case. Treat expected output as a fixture, not a live measurement.
