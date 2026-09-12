# Codex reconnect investigation — 2026-09-12

## Observed failure

A Point-Marketing conversation launched by Inferay with Codex 0.154.0 and
`gpt-6-astra` stopped producing output after a tool result at 13:47:24 local time.
Codex logged `Broken pipe` while sending its model request, followed by a send
idle timeout and five retries. At 14:04:59 it fell back to HTTP. The conversation
subsequently resumed tool activity, confirmed at 14:13:55.

The images in that request came from tool results, not user attachments. Three
batches contained 24 images with approximately 14.62 MB of base64 image data.
This is an observed correlation with the failing request, not proof of a
particular server payload limit.

## Comparison outside Inferay

Isolated, ephemeral app-server sessions used the same installed Codex binary,
account configuration and model, with read-only permissions and instructions to
reply `OK` without using tools. No live conversation was resumed or modified.

- Text-only: default WebSocket completed in 20.4 seconds; HTTP completed in
  18.0 seconds.
- The same 24 tool-returned images: the default transport reproduced a send
  `Broken pipe`; both transports exceeded the diagnostic's 180-second limit.
- HTTP logs confirmed a compressed request body of approximately 10.86 MB.

The isolated reproduction rules out the Inferay renderer as a necessary cause
of this particular upload failure. It does not distinguish network behavior,
Codex transport behavior, or backend behavior. HTTP avoids the observed
WebSocket retry sequence; it does not guarantee low latency for large requests.

## Adapter problems and changes

1. Inferay creates an app-server process for each turn. Codex's HTTP fallback is
   held in memory for a session; recreating the process loses it. The default
   OpenAI path now uses an HTTP Responses provider from the beginning. The
   override is scoped to the thread request, uses existing OpenAI authentication,
   retains the configured OpenAI base URL and organization/project headers, and
   leaves explicitly configured custom providers alone. It does not edit the
   user's Codex configuration. A separate provider ID is required because Codex
   does not generally allow overriding built-in providers.
2. `thread/resume` errors were discarded and followed by `thread/start`. Resume
   failures now surface without silently replacing the conversation.
3. Unsupported server requests were ignored, leaving the server waiting for a
   reply. They now receive an explicit JSON-RPC method-not-found response.
   This prevents a silent wait; it does not implement the requested capability.
4. Server requests and client responses could have the same numeric ID. The
   adapter now distinguishes requests by their `method` field before matching
   responses to pending calls.
5. Stop sent `turn/interrupt` without a completion deadline. An unresponsive
   turn is now terminated five seconds after the interrupt is sent.
6. Notifications reset the startup RPC timeout, and writes had no timeout.
   Startup RPCs now have a fixed reply deadline and pipe writes are bounded.

Regression tests use a child-process protocol fixture to exercise unsupported
requests during startup and active turns, failed resume, ignored interruption,
and continuous notifications that never answer an RPC. Transport configuration
also has coverage for preserving custom providers and an OpenAI endpoint.

## Follow-up boundaries

A persistent per-pane app-server could preserve connections and reduce repeated
startup work, but requires a separate lifecycle change. The current fix does not
attempt that redesign. Unsupported approval/elicitation interfaces need actual
UI support before Inferay can fulfill them; returning an explicit error is the
interim behavior. Very large image requests can still be slow.

## Upstream references

- [App Server protocol](https://developers.openai.com/codex/app-server): requests,
  responses, server-initiated requests and turn lifecycle. The installed binary's
  `app-server generate-json-schema` output was checked as well.
- [Model client](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs):
  session-scoped HTTP fallback and provider transport capability.
- [Provider configuration](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs):
  built-in OpenAI defaults and merging configured providers.

Changes require rebuilding and restarting Inferay; an already-running app-server
continues using its original configuration.
