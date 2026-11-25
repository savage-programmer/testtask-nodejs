# Interview demo run-sheet (45 min)

## Before the call (5 min)
1. Terminal in the project folder. Check `node --version` (24.x) and that `.env` has
   `PORT=3100` plus the key for the provider you will show.
2. Start the server you will demo (two terminals is fine):
   - Offline, deterministic: `npm start` (rules provider; no network, nothing can fail)
   - Real model: `$env:AI_PROVIDER="gemini"; npm start` (or `openrouter`)
3. Postman: import `postman/TestTask.postman_collection.json` and
   `postman/Local.postman_environment.json`, select the "TestTask Local" environment.
4. Run `npm test` once so the 46 green tests are in the terminal history.

## Demo order (Postman collection runs top to bottom)
| # | Request | What to say |
|---|---|---|
| 1 | Health | Express 5, async handlers, central error handler. |
| 2 | Chat: example message | Structured JSON: intent / sentiment / priority / language / response. Validated with Zod before it is stored. `source` shows which provider answered. |
| 3 | Follow-up, same user | `sequence: 2`; the provider received message 1 as context. Rule provider escalates and says "already contacted". |
| 4 | Prompt injection | `flags: ["prompt_injection"]`; response never claims approval. Customer text is untrusted data in the prompt; output guard removes action claims; model has no tools, so it cannot act anyway. |
| 5 | Hindi message | Language detection; with a real model the reply is in Hindi. |
| 6, 7 | Invalid payload, malformed JSON | Zod errors with field details; JSON body parse errors are 400 not 500. |
| 8, 9, 10 | History (two users, invalid id) | Isolation: validated userId -> keyed store -> prompt filter. Each user sees only their own history. |
| 11 | Stats | Aggregates computed from the store. |
| 12 | Unknown route | 404 is JSON too. |
| 13 | Rate limit | Collection Runner, 25 iterations: 20 x 201 then 429 with `Retry-After`. Per-IP limit also exists. |

## Failure handling to demonstrate (pick one or two)
- **Timeout**: set `AI_TIMEOUT_MS=1` and restart with a real provider; every chat
  returns 201 from rules with `fallbackReason: "timeout"`.
- **Provider unavailable**: `AI_PROVIDER=gemini` with a wrong `AI_MODEL=nope`; the
  server log shows the 404, the client still gets 201 with `fallbackReason: "provider_error"`.
- **Invalid model output**: `npm test` -> `part3.test.js` "a paragraph instead of JSON".
- **Concurrency**: `npm test` -> "two simultaneous requests for the same user" and the
  Part 4 racy-store reproduction + fix.

## Architecture in one breath
Request -> JSON parse -> per-IP limit -> Zod validation -> per-user limit -> chat
service (per-user lock: load own history -> `ai.analyze` -> validate -> append) ->
response. `ai` = guards( fallback( timeout(vendor adapter), rules ) ). Vendors
(Claude, Gemini, OpenRouter, Ollama, mock) share one prompt, one Zod schema and one
interface, selected by `AI_PROVIDER`. Full answers in `DEFENCE.md`.

## curl equivalents (PowerShell)
```
curl.exe -X POST http://localhost:3100/chat -H "Content-Type: application/json" -d "{\"userId\":\"rahul-001\",\"message\":\"My withdrawal has been pending for 3 hours. Nobody is helping me. I want my money back.\"}"
curl.exe http://localhost:3100/history/rahul-001
curl.exe http://localhost:3100/stats
```
Note: non-ASCII text (the Hindi message) is mangled by curl on Windows; use Postman for it.
