# Security Policy

## Supported Versions

Ambit is currently in public beta. Security fixes target the latest public beta release and the current `main` branch.

## Reporting A Vulnerability

Please do not open a public GitHub issue for suspected vulnerabilities.

Report security issues privately through GitHub Security Advisories for this repository. Include:

- affected Ambit version or commit
- operating system and install method
- steps to reproduce
- expected impact
- any relevant logs or screenshots with personal paths and secrets removed

We will acknowledge valid reports as quickly as practical, investigate the issue, and coordinate a fix or mitigation before public disclosure when needed.

## Security Scope

Ambit is local-first desktop software. High-priority reports include unsafe filesystem access, path-scope bypasses, updater/signing problems, secret handling issues, and vulnerabilities that expose local image libraries or metadata.

Optional network integrations, such as Gemini analysis and model-hash lookups, should never send data unless the user has configured or triggered that feature.
