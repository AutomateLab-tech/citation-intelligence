# Security

## Reporting a vulnerability

Email `citation@automatelab.tech` with a description, reproduction steps, and impact. Expect an acknowledgement within 72 hours.

Do not file public GitHub issues for security reports.

## Scope

- The MCP server process and its dependencies
- The local cache file format

Out of scope: vulnerabilities in third-party APIs (Anthropic, OpenAI, Google, Perplexity, Microsoft, SerpAPI). Report those to the respective vendor.

## API keys

API keys are read from environment variables on the MCP process and passed straight to the vendor APIs. They are never logged, never persisted to disk, and never sent to any third party. If you find a code path that does otherwise, report it as a security issue.
